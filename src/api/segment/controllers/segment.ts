/**
 * segment controller
 */

import { factories } from "@strapi/strapi";

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
      const relatedEvent = await strapi.documents("api::event.event").findOne({
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
  }),
);
