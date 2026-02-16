/**
 * score controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::score.score",
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
    async createScore(ctx) {
      const {
        data,
      }: {
        data: {
          value: number;
          participant: string;
          category: string;
          judge: string;
          event: string;
          segment: string;
        };
      } = ctx.request.body;

      if (typeof data.value !== "number" || Number.isNaN(data.value)) {
        return ctx.badRequest("Score value must be a valid number.");
      }

      const segment = await strapi.documents("api::segment.segment").findOne({
        documentId: data.segment,
        populate: {
          categories: true,
        },
      });

      if (!segment) {
        return ctx.notFound("Segment not found.");
      }

      const category = segment.categories?.find(
        (c) => c.documentId === data.category,
      );

      if (!category) {
        return ctx.badRequest("Category does not belong to this segment.");
      }

      if (category.locked) {
        return ctx.badRequest("Category is already locked for scoring.");
      }

      let maxScore: number;

      switch (segment.scoring_mode) {
        case "normalized":
          maxScore = 100;
          break;

        case "raw_category":
          if (typeof category.weight !== "number") {
            return ctx.badRequest("Category weight is not defined.");
          }
          maxScore = category.weight * 100;
          break;

        default:
          return ctx.badRequest("Invalid segment scoring mode.");
      }

      if (data.value < 0 || data.value > maxScore) {
        return ctx.badRequest(
          `Invalid score. Allowed range: 0 to ${maxScore}.`,
        );
      }

      // optional: prevent duplicate scoring
      const existingScore = await strapi
        .documents("api::score.score")
        .findFirst({
          filters: {
            participant: {
              documentId: {
                $eq: data.participant,
              },
            },
            category: {
              documentId: {
                $eq: data.category,
              },
            },

            judge: {
              documentId: {
                $eq: data.judge,
              },
            },

            segment: {
              documentId: {
                $eq: data.segment,
              },
            },
          },
        });

      if (existingScore) {
        return ctx.badRequest("Score already exists for this category.");
      }

      const createdScore = await strapi.documents("api::score.score").create({
        data: {
          value: data.value,
          participant: data.participant,
          category: data.category,
          judge: data.judge,
          event: data.event,
          segment: data.segment,
        },
      });

      const sanitizedEntity = await this.sanitizeOutput(createdScore, ctx);

      return this.transformResponse(sanitizedEntity);
    },

    async updateScore(ctx) {
      const { scoreId } = ctx.params;
      const { data } = ctx.request.body;

      // Find the score to get its current data
      const scoreToUpdate = await strapi.documents("api::score.score").findOne({
        documentId: scoreId,
        populate: {
          participant: true,
          category: true,
          judge: true,
          event: true,
          segment: true,
        },
      });

      if (!scoreToUpdate) {
        return ctx.notFound("Score not found.");
      }

      if (typeof data.value !== "number" || Number.isNaN(data.value)) {
        return ctx.badRequest("Score value must be a valid number.");
      }

      const segment = await strapi.documents("api::segment.segment").findOne({
        documentId: data.segment,
        populate: {
          categories: true,
        },
      });

      if (!segment) {
        return ctx.notFound("Segment not found.");
      }

      const category = segment.categories?.find(
        (c) => c.documentId === data.category,
      );

      if (!category) {
        return ctx.badRequest("Category does not belong to this segment.");
      }

      if (category.locked) {
        return ctx.badRequest("Category is already locked for scoring.");
      }

      let maxScore: number;

      switch (segment.scoring_mode) {
        case "normalized":
          maxScore = 100;
          break;

        case "raw_category":
          if (typeof category.weight !== "number") {
            return ctx.badRequest("Category weight is not defined.");
          }
          maxScore = category.weight * 100;
          break;

        default:
          return ctx.badRequest("Invalid segment scoring mode.");
      }

      if (data.value < 0 || data.value > maxScore) {
        return ctx.badRequest(
          `Invalid score. Allowed range: 0 to ${maxScore}.`,
        );
      }

      // optional: prevent duplicate scoring
      const existingScore = await strapi
        .documents("api::score.score")
        .findFirst({
          filters: {
            participant: {
              documentId: {
                $eq: data.participant,
              },
            },
            category: {
              documentId: {
                $eq: data.category,
              },
            },

            judge: {
              documentId: {
                $eq: data.judge,
              },
            },

            segment: {
              documentId: {
                $eq: data.segment,
              },
            },
          },
        });

      if (!existingScore) {
        return ctx.badRequest(
          "Score does not exist for this category and participant.",
        );
      }

      const updatedScore = await strapi.documents("api::score.score").update({
        documentId: scoreId,
        data: data,
      });
      const sanitizedEntity = await this.sanitizeOutput(updatedScore, ctx);

      return this.transformResponse(sanitizedEntity);
    },
  }),
);
