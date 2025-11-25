/**
 * judge-request controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::judge-request.judge-request",
  ({ strapi }) => ({
    async create(ctx) {
      const requestBody = ctx.request.body;
      const data = requestBody.data;

      // Get and filter events linked to current user (judge)
      const existingRequest = await strapi
        .documents("api::judge-request.judge-request")
        .findFirst({
          populate: "*",
          filters: {
            event: { documentId: data.event.connect[0] },
            judge: { documentId: data.judge.connect[0] },
          },
        });

      if (existingRequest) {
        return ctx.conflict("Existing judge request found", {
          type: "hasExistingRequest",
        });
      }

      const isJudgingEvent = await strapi
        .documents("api::event.event")
        .findFirst({
          populate: "*",
          filters: {
            judges: { documentId: data.judge.connect[0] },
            documentId: data.event.connect[0],
          },
        });

      if (isJudgingEvent) {
        return ctx.conflict("User is already judging event", {
          type: "isJudging",
        });
      }

      const response = await strapi
        .documents("api::judge-request.judge-request")
        .create({ data, populate: "*" });
      return response;
    },
  }),
);
