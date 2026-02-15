/**
 * segment controller
 */

import { factories } from "@strapi/strapi";

function calculateSegmentScores(activeParticipants, scores, categories) {
  const participantScores = activeParticipants.map((participant) => {
    let totalScore = 0;
    const categoryScores = {};

    for (const category of categories) {
      const activeJudges = (category.active_judges || []) as Array<{
        id: number;
      }>;
      const activeJudgeIds = activeJudges.map((j) => j.id);
      const activeJudgesCount = activeJudgeIds.length;

      if (activeJudgesCount === 0) {
        categoryScores[category.name] = 0;
        continue;
      }

      const catScores = scores.filter(
        (s) =>
          s.participant?.id === participant.id &&
          s.category?.id === category.id &&
          s.judge &&
          activeJudgeIds.includes(s.judge.id),
      );

      const sumOfScores = catScores.reduce((sum, s) => sum + s.value, 0);
      const averageScore = sumOfScores / activeJudgesCount;

      totalScore += averageScore;
      categoryScores[category.name] = averageScore;
    }

    return {
      ...participant,
      totalScore,
      categoryScores,
    };
  });

  return participantScores.sort((a, b) => b.totalScore - a.totalScore);
}

function determineEliminations(participantScores, segment) {
  const toEliminate = [];
  const toAdvance = [];
  let tieDetected = false;

  const processGroup = (groupScores, advancementType, advancementValue) => {
    const groupToEliminate = [];
    const groupToAdvance = [];
    let groupTieDetected = false;

    if (advancementType === "top_n") {
      const N = advancementValue;
      if (N === null || N === undefined) {
        throw new Error(
          "advancement_value must be set for 'top_n' advancement.",
        );
      }

      if (groupScores.length > N) {
        const cutoffScore = groupScores[N - 1].totalScore;
        let participantsAtCutoff = 0;
        for (let i = 0; i < groupScores.length; i++) {
          if (groupScores[i].totalScore >= cutoffScore) {
            groupToAdvance.push(groupScores[i]);
            if (groupScores[i].totalScore === cutoffScore) {
              participantsAtCutoff++;
            }
          } else {
            groupToEliminate.push(groupScores[i]);
          }
        }
        if (participantsAtCutoff > 1 && groupToAdvance.length > N) {
          groupTieDetected = true; // Ties exceed N, requires admin confirmation
        }
      } else {
        groupToAdvance.push(...groupScores);
      }
    } else if (advancementType === "threshold") {
      const threshold = advancementValue;
      if (threshold === null || threshold === undefined) {
        throw new Error(
          "advancement_value must be set for 'threshold' advancement.",
        );
      }

      let advancedCount = 0;
      for (const participant of groupScores) {
        if (participant.totalScore >= threshold) {
          groupToAdvance.push(participant);
          advancedCount++;
        } else {
          groupToEliminate.push(participant);
        }
      }
      if (advancedCount === 0 && groupScores.length > 0) {
        throw new Error(
          "Zero participants advanced in a gender group. Admin confirmation required.",
        );
      }
    }

    return { groupToEliminate, groupToAdvance, groupTieDetected };
  };

  if (
    segment.advancement_type === "top_n" ||
    segment.advancement_type === "threshold"
  ) {
    const maleScores = participantScores.filter((p) => p.gender === "male");
    const femaleScores = participantScores.filter((p) => p.gender === "female");

    const maleResults = processGroup(
      maleScores,
      segment.advancement_type,
      segment.advancement_value,
    );
    toEliminate.push(...maleResults.groupToEliminate);
    toAdvance.push(...maleResults.groupToAdvance);
    if (maleResults.groupTieDetected) tieDetected = true;

    const femaleResults = processGroup(
      femaleScores,
      segment.advancement_type,
      segment.advancement_value,
    );
    toEliminate.push(...femaleResults.groupToEliminate);
    toAdvance.push(...femaleResults.groupToAdvance);
    if (femaleResults.groupTieDetected) tieDetected = true;
  } else {
    switch (segment.advancement_type) {
      case "all":
        toAdvance.push(...participantScores);
        break;
      case "manual":
        toAdvance.push(...participantScores);
        break;
      default:
        throw new Error(
          `Unknown advancement type: ${segment.advancement_type}`,
        );
    }
  }

  return { toEliminate, toAdvance, tieDetected };
}

export default factories.createCoreController(
  "api::segment.segment",
  ({ strapi }) => ({
    async testAction(ctx) {
      const { data } = ctx.request.body;
      const queryParams = ctx.request.query;
      const path = ctx.request.path;
      ctx.body = "Segment Custom Controller";

      const sanitizedOutput = await this.sanitizeOutput(
        { requestData: data, queryParams, path },
        ctx,
      );

      return this.transformResponse(sanitizedOutput);
    },

    // Create with segment order validation
    async customCreate(ctx) {
      const { data } = ctx.request.body;

      // Validate event segment order field uniqueness
      const relatedEvent: any = await strapi
        .documents("api::event.event")
        .findOne({
          documentId: data.event.documentId,
          populate: { segments: true },
        });

      if (!relatedEvent) {
        return ctx.notFound("Event to be linked cannot be found.");
      }

      if (relatedEvent.segments.find((s) => s.order === data.order)) {
        return ctx.conflict("A segment with this order already exists");
      } else {
        const entity = await strapi
          .service("api::segment.segment")
          .create({ data });
        const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

        ctx.status = 201;
        return this.transformResponse(sanitizedEntity);
      }
    },

    async activateSegment(ctx) {
      const body = ctx.request.body as {
        documentId: string;
        data: {
          segment_status: "draft" | "inactive" | "active" | "closed";
        };
      };

      // Check if event is active
      const segment: any = await strapi
        .documents("api::segment.segment")
        .findOne({
          documentId: body.documentId,
          populate: {
            event: true,
            categories: true,
          },
        });

      if (!segment) {
        return ctx.notFound("Segment cannot be found.");
      }

      if (segment.event.event_status !== "active") {
        return ctx.badRequest(
          "Event must be active before activating a segment.",
        );
      }
      if (segment.segment_status === "active") {
        return ctx.badRequest("Segment is already active.");
      } else if (segment.segment_status === "closed") {
        return ctx.badRequest(
          "Segment has already been closed and cannot be reactivated again.",
        );
      } else {
        const activatedSegment = await strapi
          .documents("api::segment.segment")
          .update(body);

        const sanitizedOutput = await this.sanitizeOutput(
          activatedSegment,
          ctx,
        );

        return this.transformResponse(sanitizedOutput);
      }
    },

    async lockSegment(ctx) {
      const { id: documentId } = ctx.params;

      try {
        // Fetch the segment with necessary relations using documentId
        const segment = await strapi.documents("api::segment.segment").findOne({
          documentId,
          populate: {
            event: { populate: { participants: true, judges: true } },
            categories: {
              populate: {
                active_judges: true,
              },
            },
            scores: {
              populate: { participant: true, category: true, judge: true },
            },
          },
        });

        // console.log("Segment To Close (with populated scores and categories):", {
        //   id: segment.id,
        //   segment_status: segment.segment_status,
        //   event: { id: segment.event.id, participants: segment.event.participants.map(p => p.id) },
        //   categories: segment.categories.map(c => ({ id: c.id, name: c.name, weight: c.weight })),
        //   scores: segment.scores.map(s => ({ id: s.id, value: s.value, participant: s.participant.id, category: s.category.id, judge: s.judge.id }))
        // });

        if (!segment) {
          throw new Error("Segment not found.");
        }

        if (segment.segment_status !== "active") {
          throw new Error(
            "Segment cannot be locked as it is not in 'active' status.",
          );
        }

        // Filter active participants only
        const activeParticipants = segment.event.participants.filter(
          (p) => p.participant_status === "active",
        );

        console.log(
          "Active Participants:",
          activeParticipants.map((p) => p.id),
        );

        // Calculate scores for each active participant
        const participantScores = calculateSegmentScores(
          activeParticipants,
          segment.scores,
          segment.categories,
        );

        console.log("Participant Scores", participantScores);

        // Determine eliminations based on advancement rule
        const { toEliminate, toAdvance, tieDetected } = determineEliminations(
          participantScores,
          segment,
        );

        // Update eliminated participants using entityService and numeric IDs
        for (const participant of toEliminate) {
          await strapi.entityService.update(
            "api::participant.participant",
            participant.id,
            {
              data: {
                participant_status: "eliminated",
                eliminated_at_segment: segment.id,
              },
            },
          );
        }

        // Lock the segment using entityService and numeric ID
        await strapi.entityService.update("api::segment.segment", segment.id, {
          data: { segment_status: "closed" },
        });

        // TODO: Report ties if tieDetected is true
        console.log("Tie detected:", tieDetected);

        // Return the updated segment
        const lockedSegment = await strapi.entityService.findOne(
          "api::segment.segment",
          segment.id,
        );
        const sanitizedOutput = await this.sanitizeOutput(lockedSegment, ctx);
        return this.transformResponse(sanitizedOutput);
      } catch (error) {
        if (error.message.includes("not found")) {
          return ctx.notFound(error.message);
        }
        if (error.message.includes("cannot be locked")) {
          return ctx.badRequest(error.message);
        }
        console.error(error);
        return ctx.internalServerError("An unexpected error occurred.");
      }
    },
  }),
);
