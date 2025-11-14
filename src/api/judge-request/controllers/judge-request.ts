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
      console.log("Judge Request Body", requestBody);

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

      console.log("Existing Request", existingRequest);

      if (existingRequest) {
        return ctx.conflict("Existing judge request found");
      }

      console.log("Valid Request: Creating new judge request");
      const response = await strapi
        .documents("api::judge-request.judge-request")
        .create({ data, populate: "*" });
      return response;
    },
  }),
);
