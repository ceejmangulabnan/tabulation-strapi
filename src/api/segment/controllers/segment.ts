/**
 * segment controller
 */

import { factories } from "@strapi/strapi";

function calculateSegmentScores(activeParticipants, scores, categories) {
  const participantScoresMap = new Map();

  for (const participant of activeParticipants) {
    participantScoresMap.set(participant.id, {
      ...participant,
      totalScore: 0,
      categoryScores: {},
    });
  }

  for (const score of scores) {
    const participantEntry = participantScoresMap.get(score.participant.id);
    if (participantEntry) {
      const category = categories.find((cat) => cat.id === score.category.id);
      if (category) {
        const weightedScore = score.value * category.weight;
        participantEntry.totalScore += weightedScore;
        participantEntry.categoryScores[category.name] = weightedScore;
      }
    }
  }

  return Array.from(participantScoresMap.values()).sort(
    (a, b) => b.totalScore - a.totalScore,
  );
}

function determineEliminations(participantScores, segment) {
  const toEliminate = [];
  const toAdvance = [];
  let tieDetected = false;

  switch (segment.advancement_type) {
    case "all":
      toAdvance.push(...participantScores);
      break;
    case "top_n":
      const N = segment.advancement_value;
      if (N === null || N === undefined) {
        throw new Error(
          "advancement_value must be set for 'top_n' advancement.",
        );
      }

      if (participantScores.length > N) {
        const cutoffScore = participantScores[N - 1].totalScore;
        let participantsAtCutoff = 0;
        for (let i = 0; i < participantScores.length; i++) {
          if (participantScores[i].totalScore >= cutoffScore) {
            toAdvance.push(participantScores[i]);
            if (participantScores[i].totalScore === cutoffScore) {
              participantsAtCutoff++;
            }
          } else {
            toEliminate.push(participantScores[i]);
          }
        }
        if (participantsAtCutoff > 1 && toAdvance.length > N) {
          tieDetected = true; // Ties exceed N, requires admin confirmation
        }
      } else {
        toAdvance.push(...participantScores);
      }
      break;
    case "threshold":
      const threshold = segment.advancement_value;
      if (threshold === null || threshold === undefined) {
        throw new Error(
          "advancement_value must be set for 'threshold' advancement.",
        );
      }

      let advancedCount = 0;
      for (const participant of participantScores) {
        if (participant.totalScore >= threshold) {
          toAdvance.push(participant);
          advancedCount++;
        } else {
          toEliminate.push(participant);
        }
      }
      if (advancedCount === 0 && participantScores.length > 0) {
        throw new Error("Zero participants advanced. Admin confirmation required.");
      }
      break;
    case "manual":
      // All go to toAdvance, but will require manual selection by admin
      toAdvance.push(...participantScores);
      break;
    default:
      throw new Error(`Unknown advancement type: ${segment.advancement_type}`);
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

    // async deactivateSegment(ctx) {},

    async lockSegment(ctx) {
      const { id: documentId } = ctx.params;

      try {
        // Fetch the segment with necessary relations using documentId
        const segment: any = await strapi
          .documents("api::segment.segment")
          .findOne({
            documentId,
            populate: {
              event: { populate: { participants: true } },
              categories: true,
              scores: { populate: { participant: true, category: true } },
            },
          });

        console.log("Segment To Close:", segment);

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

        // Calculate scores for each active participant
        const participantScores = calculateSegmentScores(
          activeParticipants,
          segment.scores,
          segment.categories,
        );

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
