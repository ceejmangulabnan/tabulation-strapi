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
          (participantScores.length || 1);

        return {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          averaged_score: Number(avg.toFixed(4)),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      const rankedMale = denseRank(maleRows);
      const rankedFemale = denseRank(femaleRows);

      ctx.body = {
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

      const segment = await strapi.documents("api::segment.segment").findOne({
        documentId: segmentId,
        populate: {
          categories: true,
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

          const avg =
            catScores.reduce((sum, s) => sum + s.value, 0) / catScores.length;

          // avg is already 0  category.weight * 100
          segmentTotal += avg;
        }

        return {
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          averaged_score: Number(segmentTotal.toFixed(3)),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
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
              categories: true,
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

          for (const category of segment.categories) {
            const catScores = scores.filter(
              (s) =>
                s.participant.documentId === p.documentId &&
                s.segment.documentId === segment.documentId &&
                s.category.documentId === category.documentId,
            );

            if (!catScores.length) continue;

            const avg =
              catScores.reduce((sum, s) => sum + s.value, 0) / catScores.length;

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
          averaged_score: Number(finalScore.toFixed(3)),
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },
  }),
);
