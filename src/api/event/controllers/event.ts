/**
 * event controller
 */

import { factories } from "@strapi/strapi";

type RankingRow = {
  participant_number: number;
  name: string;
  department: string;
  gender: "male" | "female";
  averaged_score: number;
  raw_averaged_score: number;
  rank: number;
};

function denseRank(rows: Omit<RankingRow, "rank">[]): RankingRow[] {
  let rank = 1;
  let prevScore: number | null = null;

  return rows.map((row, index) => {
    if (prevScore !== null && row.averaged_score < prevScore) {
      rank = index + 1;
    }

    prevScore = row.averaged_score;

    return { ...row, rank };
  });
}

export default factories.createCoreController(
  "api::event.event",
  ({ strapi }) => ({
    async testAction(ctx) {
      const { data } = ctx.request.body;
      const queryParams = ctx.request.query;
      const path = ctx.request.path;

      const sanitizedOutput = await this.sanitizeOutput(
        { requestData: data, queryParams, path },
        ctx,
      );

      return this.transformResponse(sanitizedOutput);
    },

    async activateEvent(ctx) {
      const {
        data: { documentId },
      } = ctx.request.body as { data: { documentId: string } };

      if (!documentId) {
        return ctx.badRequest("Event ID is required");
      }

      const event = await strapi.documents("api::event.event").findOne({
        documentId: documentId,
        populate: {
          segments: {
            populate: {
              categories: true,
            },
          },
          participants: true,
          judges: true,
        },
      });

      if (!event) {
        return ctx.notFound("Event not found");
      }

      if (event.event_status !== "draft") {
        return ctx.badRequest(`Event status is already ${event.event_status}`);
      }

      if (!event.segments || event.segments.length === 0) {
        return ctx.badRequest("Event must have at least one segment");
      }

      if (!event.participants || event.participants.length === 0) {
        return ctx.badRequest("Event must have at least one participant");
      }

      // Initial activation guard for segment status
      const invalidSegment = event.segments.find(
        (s) => s.segment_status !== "inactive" && s.segment_status !== "draft",
      );

      if (invalidSegment) {
        return ctx.badRequest(
          "All segments must be draft or inactive before activation",
        );
      }

      const segmentOrders = event.segments.map((segment) => segment.order);
      if (new Set(segmentOrders).size !== segmentOrders.length) {
        return ctx.badRequest("Segment order values must be unique");
      }

      const participantKeys = event.participants.map(
        (p) => `${p.number}-${p.gender}`,
      );
      if (new Set(participantKeys).size !== participantKeys.length) {
        return ctx.badRequest(
          "Participant number and gender combination must be unique",
        );
      }

      const totalSegmentWeight = event.segments.reduce(
        (sum, segment) => sum + (segment.weight || 0),
        0,
      );

      const isOne = (n: number) => Math.abs(n - 1.0) < 0.0001;

      if (!isOne(totalSegmentWeight)) {
        return ctx.badRequest("Total segment weight must be 1.0");
      }

      for (const segment of event.segments) {
        const totalCategoryWeight = segment.categories.reduce(
          (sum, category) => sum + (category.weight || 0),
          0,
        );
        if (totalCategoryWeight !== 1.0) {
          return ctx.badRequest(
            `Total category weight for segment #${segment.order} must be 1.0`,
          );
        }
      }

      if (!event.judges || event.judges.length === 0) {
        return ctx.badRequest(
          "At least one judge must be assigned to the event",
        );
      }

      const updatedEvent = await strapi.documents("api::event.event").update({
        documentId: documentId,
        data: {
          event_status: "active",
        },
      });

      const sanitizedOutput = await this.sanitizeOutput(updatedEvent, ctx);
      return this.transformResponse(sanitizedOutput);
    },

    async getCategoryRank(ctx) {
      const { eventId, segmentId, categoryId } = ctx.params;

      if (!eventId || !segmentId || !categoryId) {
        return ctx.badRequest("Missing parameters");
      }

      // fetch event
      const event = await strapi.documents("api::event.event").findOne({
        documentId: eventId,
      });

      // fetch participants
      const participants = await strapi
        .documents("api::participant.participant")
        .findMany({
          filters: {
            event: { documentId: eventId },
            participant_status: "active",
          },
          populate: {
            department: true,
          },
        });

      // fetch category to get active judges
      const category = await strapi
        .documents("api::category.category")
        .findOne({
          documentId: categoryId,
          populate: {
            active_judges: true,
          },
        });

      if (!category) {
        return ctx.notFound("Category not found");
      }

      const activeJudgesCount = category.active_judges
        ? category.active_judges.length
        : 0;

      if (activeJudgesCount === 0) {
        return ctx.badRequest("No active judges found for this category");
      }

      // fetch scores
      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
          segment: { documentId: segmentId },
          category: { documentId: categoryId },
        },
        populate: {
          participant: true,
        },
      });

      const rows = participants.map((p) => {
        const participantScores = scores.filter(
          (s) => s.participant.documentId === p.documentId,
        );

        const avg =
          participantScores.reduce((sum, s) => sum + s.value, 0) /
          activeJudgesCount;

        return {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          averaged_score: Number(avg.toFixed(2)),
          raw_averaged_score: Number(avg),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      const rankedMale = denseRank(maleRows);
      const rankedFemale = denseRank(femaleRows);

      ctx.body = {
        event,
        results: {
          male: rankedMale,
          female: rankedFemale,
        },
      };
    },
    async getSegmentRank(ctx) {
      const { eventId, segmentId } = ctx.params;

      if (!eventId || !segmentId) {
        return ctx.badRequest("Missing parameters");
      }

      const event = await strapi.documents("api::event.event").findOne({
        documentId: eventId,
      });

      const segment = await strapi.documents("api::segment.segment").findOne({
        documentId: segmentId,
        populate: {
          categories: {
            populate: {
              active_judges: true,
            },
          },
        },
      });

      if (!segment) {
        return ctx.notFound("Segment not found");
      }

      const participants = await strapi
        .documents("api::participant.participant")
        .findMany({
          filters: {
            event: { documentId: eventId },
            participant_status: "active",
          },
          populate: {
            department: true,
          },
        });

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
          segment: { documentId: segmentId },
        },
        populate: {
          participant: true,
          category: true,
        },
      });

      const rows = participants.map((p) => {
        let segmentTotal = 0;

        for (const category of segment.categories) {
          const catScores = scores.filter(
            (s) =>
              s.participant.documentId === p.documentId &&
              s.category.documentId === category.documentId,
          );

          if (!catScores.length) continue;

          const activeJudgesCount = category.active_judges
            ? category.active_judges.length
            : 0;

          if (activeJudgesCount === 0) {
            // If no active judges, this category contributes 0 to the segment total
            continue;
          }

          const avg =
            catScores.reduce((sum, s) => sum + s.value, 0) / activeJudgesCount;

          // avg is already 0  category.weight * 100
          segmentTotal += avg;
        }

        return {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          averaged_score: Number(segmentTotal.toFixed(2)),
          raw_averaged_score: Number(segmentTotal),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        event,
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },

    async getFinalRank(ctx) {
      const { eventId } = ctx.params;

      if (!eventId) {
        return ctx.badRequest("Missing eventId");
      }

      const event = await strapi.documents("api::event.event").findOne({
        documentId: eventId,
        populate: {
          segments: {
            populate: {
              categories: {
                populate: {
                  active_judges: true,
                },
              },
            },
          },
        },
      });

      if (!event) {
        return ctx.notFound("Event not found");
      }

      const participants = await strapi
        .documents("api::participant.participant")
        .findMany({
          filters: {
            event: { documentId: eventId },
            participant_status: "active",
          },
          populate: {
            department: true,
          },
        });

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
        },
        populate: {
          participant: true,
          category: true,
          segment: true,
        },
      });

      const rows = participants.map((p) => {
        let finalScore = 0;

        for (const segment of event.segments) {
          let segmentTotal = 0;

          // Cat avg without active_judges
          // for (const category of segment.categories) {
          //   const catScores = scores.filter(
          //     (s) =>
          //       s.participant.documentId === p.documentId &&
          //       s.segment.documentId === segment.documentId &&
          //       s.category.documentId === category.documentId,
          //   );
          //
          //   if (!catScores.length) continue;
          //
          //   const avg =
          //     catScores.reduce((sum, s) => sum + s.value, 0) / catScores.length;
          //
          //   // avg already respects category.weight
          //   segmentTotal += avg;
          // }

          // With active_judges
          for (const category of segment.categories) {
            const catScores = scores.filter(
              (s) =>
                s.participant.documentId === p.documentId &&
                s.segment.documentId === segment.documentId &&
                s.category.documentId === category.documentId,
            );

            if (!catScores.length) continue;

            const activeJudgesCount = category.active_judges
              ? category.active_judges.length
              : 0;

            if (activeJudgesCount === 0) {
              // If no active judges, this category contributes 0 to the segment total
              continue;
            }

            const avg =
              catScores.reduce((sum, s) => sum + s.value, 0) /
              activeJudgesCount;

            // avg already respects category.weight
            segmentTotal += avg;
          }

          /**
           * IMPORTANT:
           * - normalized: segmentTotal already equals segment.weight * 100
           * - raw_category: categories already add up to segment max
           * never multiply by segment.weight here
           */
          if (segment.scoring_mode === "normalized") {
            finalScore += segmentTotal * segment.weight;
          } else {
            // raw_category
            finalScore += segmentTotal;
          }
        }

        return {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          averaged_score: Number(finalScore.toFixed(2)),
          raw_averaged_score: Number(finalScore),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        event,
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },

    async getCategoryScoresPerJudge(ctx) {
      const { eventId, segmentId, categoryId } = ctx.params;

      if (!eventId || !segmentId || !categoryId) {
        return ctx.badRequest("Missing parameters");
      }

      // fetch event
      const event = await strapi.documents("api::event.event").findOne({
        documentId: eventId,
      });

      if (!event) {
        return ctx.notFound("Event not found");
      }

      // fetch participants
      const participants = await strapi
        .documents("api::participant.participant")
        .findMany({
          filters: {
            event: { documentId: eventId },
            participant_status: "active",
          },
          populate: {
            department: true,
            headshot: true, // Assuming 'headshot' is a media field that needs populating
          },
        });

      // fetch category to get active judges
      const category = await strapi
        .documents("api::category.category")
        .findOne({
          documentId: categoryId,
          populate: {
            active_judges: true,
          },
        });

      if (!category) {
        return ctx.notFound("Category not found");
      }

      const activeJudges = category.active_judges
        ? ((category.active_judges as any[]).sort((a, b) =>
            a.name.localeCompare(b.name),
          ) as Array<{ documentId: string; name: string }>)
        : [];

      const activeJudgesCount = activeJudges.length;

      if (activeJudgesCount === 0) {
        return ctx.badRequest("No active judges found for this category");
      }

      // fetch scores
      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
          segment: { documentId: segmentId },
          category: { documentId: categoryId },
        },
        populate: {
          participant: true,
          judge: true,
        },
      });

      type ExtendedRankingRow = RankingRow & {
        headshot: string | null;
        [key: `judge_${string}`]: number | null | undefined;
      };

      const rows: ExtendedRankingRow[] = participants.map((p) => {
        const participantData: Partial<ExtendedRankingRow> = {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          headshot: (p.headshot as any)?.url || null, // Assuming headshot is a media object
        };

        let sumOfScoresForAllActiveJudges = 0;
        for (const judge of activeJudges) {
          const score = scores.find(
            (s) =>
              s.participant.documentId === p.documentId &&
              (s.judge as any).documentId === judge.documentId,
          );
          const judgeScoreValue = score ? score.value : 0; // For averaging, treat missing score as 0
          participantData[`judge_${judge.name.replace(/\s/g, "_")}`] =
            score?.value ?? null; // For display, show null if no score

          sumOfScoresForAllActiveJudges += judgeScoreValue;
        }

        const raw_averaged_score =
          activeJudgesCount > 0
            ? Number(sumOfScoresForAllActiveJudges / activeJudgesCount)
            : 0;

        participantData.averaged_score = Number(raw_averaged_score.toFixed(2));
        participantData.raw_averaged_score = Number(raw_averaged_score);

        return participantData as ExtendedRankingRow;
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      const rankedMale = denseRank(maleRows); // denseRank expects Omit<RankingRow, "rank">[], but given the fields, it should still work.
      const rankedFemale = denseRank(femaleRows); // The extra fields will be carried over by the spread in denseRank

      ctx.body = {
        event,
        activeJudges: activeJudges.map((j) => ({
          documentId: j.documentId,
          name: j.name,
        })),
        results: {
          male: rankedMale,
          female: rankedFemale,
        },
      };
    },
  }),
);
