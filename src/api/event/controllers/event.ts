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

function denseRank<T extends Omit<RankingRow, "rank">>(
  rows: T[],
): (T & { rank: number })[] {
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
            eliminated_at_segment: true,
          },
        });

      // fetch category to get active judges
      const category = await strapi
        .documents("api::category.category")
        .findOne({
          documentId: categoryId,
          populate: {
            active_judges: true,
            segment: true,
          },
        });

      if (!category) {
        return ctx.notFound("Category not found");
      }

      const activeJudges = (category.active_judges || []) as Array<{
        documentId: string;
      }>;
      const activeJudgeIds = activeJudges.map((j) => j.documentId);
      const activeJudgesCount = activeJudgeIds.length;

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

      const currentSegmentOrder = category.segment.order;

      const filteredParticipants = participants.filter((p) => {
        if (!p.eliminated_at_segment) {
          return true; // Not eliminated
        }
        // If eliminated, check if eliminated at a segment *after* the current one
        return p.eliminated_at_segment.order > currentSegmentOrder;
      });

      const rows = filteredParticipants.map((p) => {
        const participantScores = scores.filter(
          (s) =>
            s.participant.documentId === p.documentId &&
            s.judge &&
            activeJudgeIds.includes(s.judge.documentId),
        );

        const avg =
          participantScores.reduce((sum, s) => sum + s.value, 0) /
          activeJudgesCount;

        return {
          eliminated_at_segment: p.eliminated_at_segment,
          isEliminated: p.participant_status === "eliminated",
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
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
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
            eliminated_at_segment: true,
          },
        });

      const filteredParticipants = participants.filter(
        (p) => !p.eliminated_at_segment,
      );

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
          segment: { documentId: segmentId },
        },
        populate: {
          participant: true,
          category: true,
          judge: true,
        },
      });

      const rows = filteredParticipants.map((p) => {
        let segmentTotal = 0;

        for (const category of segment.categories) {
          const activeJudges = (category.active_judges || []) as Array<{
            documentId: string;
          }>;
          const activeJudgeIds = activeJudges.map((j) => j.documentId);
          const activeJudgesCount = activeJudgeIds.length;

          if (activeJudgesCount === 0) {
            // If no active judges, this category contributes 0 to the segment total
            continue;
          }

          const catScores = scores.filter(
            (s) =>
              s.participant.documentId === p.documentId &&
              s.category.documentId === category.documentId &&
              s.judge &&
              activeJudgeIds.includes(s.judge.documentId),
          );

          if (!catScores.length) continue;

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
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
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
            eliminated_at_segment: true,
          },
        });

      const filteredParticipants = participants.filter(
        (p) => !p.eliminated_at_segment,
      );

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
        },
        populate: {
          participant: true,
          category: true,
          segment: true,
          judge: true,
        },
      });

      const rows = filteredParticipants.map((p) => {
        let finalScore = 0;

        for (const segment of event.segments) {
          let segmentTotal = 0;

          // With active_judges
          for (const category of segment.categories) {
            const activeJudges = (category.active_judges || []) as Array<{
              documentId: string;
            }>;
            const activeJudgeIds = activeJudges.map((j) => j.documentId);
            const activeJudgesCount = activeJudgeIds.length;

            if (activeJudgesCount === 0) {
              // If no active judges, this category contributes 0 to the segment total
              continue;
            }

            const catScores = scores.filter(
              (s) =>
                s.participant &&
                s.participant.documentId === p.documentId &&
                s.segment &&
                s.segment.documentId === segment.documentId &&
                s.category &&
                s.category.documentId === category.documentId &&
                s.judge &&
                activeJudgeIds.includes(s.judge.documentId),
            );

            if (!catScores.length) continue;

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
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
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
            // participant_status: "active",
          },
          populate: {
            department: true,
            headshot: true, // Assuming 'headshot' is a media field that needs populating
            eliminated_at_segment: true,
          },
        });

      // fetch category to get active judges
      const category = await strapi
        .documents("api::category.category")
        .findOne({
          documentId: categoryId,
          populate: {
            active_judges: true,
            segment: true,
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
        eliminated_at_segment: any;
        isEliminated: boolean;
        headshot: string | null;
        [key: `judge_${string}`]: number | null | undefined;
      };

      const rows: ExtendedRankingRow[] = participants.map((p) => {
        const participantData: Partial<ExtendedRankingRow> = {
          eliminated_at_segment: p.eliminated_at_segment,
          isEliminated: p.participant_status === "eliminated",
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          headshot: (p.headshot as any)?.url || null,
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
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
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

    async getSegmentScores(ctx) {
      const { eventId, segmentId } = ctx.params;

      if (!eventId || !segmentId) {
        return ctx.badRequest("Missing eventId or segmentId");
      }

      const event = await strapi.documents("api::event.event").findOne({
        documentId: eventId,
      });

      if (!event) {
        return ctx.notFound("Event not found");
      }

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
            // participant_status: "active",
          },
          populate: {
            department: true,
            headshot: true,
            eliminated_at_segment: true,
          },
        });

      // const filteredParticipants = participants.filter(
      //   (p) => !p.eliminated_at_segment,
      // );

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
          segment: { documentId: segmentId },
        },
        populate: {
          participant: true,
          category: true,
          judge: true,
        },
      });

      const categories = segment.categories.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      type SegmentScoresRowUnranked = Omit<RankingRow, "rank"> & {
        headshot: string | null;
        category_scores: {
          [key: string]: {
            averaged_score: number;
            raw_averaged_score: number;
          };
        };
      };

      const rows: SegmentScoresRowUnranked[] = participants.map((p) => {
        const category_scores: SegmentScoresRowUnranked["category_scores"] = {};
        let segmentTotal = 0;

        for (const category of categories) {
          const activeJudges = (category.active_judges || []) as Array<{
            documentId: string;
          }>;
          const activeJudgeIds = activeJudges.map((j) => j.documentId);
          const activeJudgesCount = activeJudgeIds.length;

          const catScores = scores.filter(
            (s) =>
              s.participant.documentId === p.documentId &&
              s.category.documentId === category.documentId &&
              s.judge &&
              activeJudgeIds.includes(s.judge.documentId),
          );

          const categoryAvg =
            activeJudgesCount > 0
              ? catScores.reduce((sum, s) => sum + s.value, 0) /
                activeJudgesCount
              : 0;

          category_scores[category.name] = {
            averaged_score: Number(categoryAvg.toFixed(2)),
            raw_averaged_score: categoryAvg,
          };
          segmentTotal += categoryAvg;
        }

        return {
          eliminated_at_segment: p.eliminated_at_segment,
          isEliminated: p.participant_status === "eliminated",
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          headshot: (p.headshot as any)?.url || null,
          category_scores,
          averaged_score: Number(segmentTotal.toFixed(2)),
          raw_averaged_score: segmentTotal,
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
        segment: {
          documentId: segment.documentId,
          name: segment.name,
          order: segment.order,
          weight: segment.weight,
        },
        categories: categories.map((c) => ({
          documentId: c.documentId,
          name: c.name,
          weight: c.weight,
        })),
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },

    async getFinalScores(ctx) {
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
            // participant_status: "active",
          },
          populate: {
            department: true,
            headshot: true,
            eliminated_at_segment: true,
          },
        });

      // const filteredParticipants = participants.filter(
      //   (p) => !p.eliminated_at_segment,
      // );

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
        },
        populate: {
          participant: true,
          category: true,
          segment: true,
          judge: true,
        },
      });

      const segments = event.segments.sort((a, b) => a.order - b.order);

      type FinalScoresRowUnranked = Omit<RankingRow, "rank"> & {
        headshot: string | null;
        segment_scores: {
          [key: string]: {
            averaged_score: number;
            raw_averaged_score: number;
          };
        };
      };

      const rows: FinalScoresRowUnranked[] = participants.map((p) => {
        const segment_scores: FinalScoresRowUnranked["segment_scores"] = {};
        let finalScore = 0;

        for (const segment of segments) {
          let segmentTotal = 0;

          for (const category of segment.categories) {
            const activeJudges = (category.active_judges || []) as Array<{
              documentId: string;
            }>;
            const activeJudgeIds = activeJudges.map((j) => j.documentId);
            const activeJudgesCount = activeJudgeIds.length;

            const catScores = scores.filter(
              (s) =>
                s.participant &&
                s.participant.documentId === p.documentId &&
                s.segment &&
                s.segment.documentId === segment.documentId &&
                s.category &&
                s.category.documentId === category.documentId &&
                s.judge &&
                activeJudgeIds.includes(s.judge.documentId),
            );

            const categoryAvg =
              activeJudgesCount > 0
                ? catScores.reduce((sum, s) => sum + s.value, 0) /
                  activeJudgesCount
                : 0;
            segmentTotal += categoryAvg;
          }

          if (segment.scoring_mode === "normalized") {
            const normalizedAverage = segmentTotal * segment.weight;

            segment_scores[segment.name] = {
              averaged_score: Number(normalizedAverage.toFixed(2)),
              raw_averaged_score: normalizedAverage,
            };
          } else {
            segment_scores[segment.name] = {
              averaged_score: Number(segmentTotal.toFixed(2)),
              raw_averaged_score: segmentTotal,
            };
          }

          if (segment.scoring_mode === "normalized") {
            finalScore += segmentTotal * segment.weight;
          } else {
            finalScore += segmentTotal;
          }
        }

        return {
          isEliminated: p.participant_status === "eliminated",
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          headshot: (p.headshot as any)?.url || null,
          segment_scores,
          averaged_score: Number(finalScore.toFixed(2)),
          raw_averaged_score: finalScore,
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
        segments: segments.map((s) => ({
          documentId: s.documentId,
          name: s.name,
          order: s.order,
          weight: s.weight,
        })),
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },

    async getFinalScoresForJudge(ctx) {
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
            // participant_status: "active",
          },
          populate: {
            department: true,
            headshot: true,
            eliminated_at_segment: true,
          },
        });

      // const filteredParticipants = participants.filter(
      //   (p) => !p.eliminated_at_segment,
      // );

      const scores = await strapi.documents("api::score.score").findMany({
        filters: {
          event: { documentId: eventId },
        },
        populate: {
          participant: true,
          category: true,
          segment: true,
          judge: true,
        },
      });

      const segments = event.segments.sort((a, b) => a.order - b.order);

      type FinalScoresRowUnranked = Omit<RankingRow, "rank"> & {
        headshot: string | null;
        segment_scores: {
          [key: string]: {
            averaged_score: number;
            raw_averaged_score: number;
          };
        };
      };

      const rows: FinalScoresRowUnranked[] = participants.map((p) => {
        const segment_scores: FinalScoresRowUnranked["segment_scores"] = {};
        let finalScore = 0;

        for (const segment of segments) {
          let segmentTotal = 0;

          for (const category of segment.categories) {
            const activeJudges = (category.active_judges || []) as Array<{
              documentId: string;
            }>;
            const activeJudgeIds = activeJudges.map((j) => j.documentId);
            const activeJudgesCount = activeJudgeIds.length;

            const catScores = scores.filter(
              (s) =>
                s.participant &&
                s.participant.documentId === p.documentId &&
                s.segment &&
                s.segment.documentId === segment.documentId &&
                s.category &&
                s.category.documentId === category.documentId &&
                s.judge &&
                activeJudgeIds.includes(s.judge.documentId),
            );

            const categoryAvg =
              activeJudgesCount > 0
                ? catScores.reduce((sum, s) => sum + s.value, 0) /
                  activeJudgesCount
                : 0;
            segmentTotal += categoryAvg;
          }

          if (segment.scoring_mode === "normalized") {
            const normalizedAverage = segmentTotal * segment.weight;

            segment_scores[segment.name] = {
              averaged_score: Number(normalizedAverage.toFixed(2)),
              raw_averaged_score: normalizedAverage,
            };
          } else {
            segment_scores[segment.name] = {
              averaged_score: Number(segmentTotal.toFixed(2)),
              raw_averaged_score: segmentTotal,
            };
          }

          if (segment.scoring_mode === "normalized") {
            finalScore += segmentTotal * segment.weight;
          } else {
            finalScore += segmentTotal;
          }
        }

        return {
          isEliminated: p.participant_status === "eliminated",
          participant_number: p.number,
          name: p.name,
          department: p.department?.name ?? "",
          gender: p.gender,
          headshot: (p.headshot as any)?.url || null,
          segment_scores,
          averaged_score: Number(finalScore.toFixed(2)),
          raw_averaged_score: finalScore,
        };
      });

      const maleRows = rows.filter((r) => r.gender === "male");
      const femaleRows = rows.filter((r) => r.gender === "female");

      maleRows.sort((a, b) => b.averaged_score - a.averaged_score);
      femaleRows.sort((a, b) => b.averaged_score - a.averaged_score);

      ctx.body = {
        event: {
          documentId: event.documentId,
          name: event.name,
          description: event.description,
        },
        segments: segments.map((s) => ({
          documentId: s.documentId,
          name: s.name,
          order: s.order,
          weight: s.weight,
        })),
        results: {
          male: denseRank(maleRows),
          female: denseRank(femaleRows),
        },
      };
    },
  }),
);
