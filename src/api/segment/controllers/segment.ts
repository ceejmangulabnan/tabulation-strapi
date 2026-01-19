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
      const { event, segment } = data;

      // Validate event segment order field uniqueness
      const relatedEvent = await strapi.db.query("api::event.event").findOne({
        where: {
          id: Number(event),
        },
        populate: { segments: true },
      });

      if (relatedEvent.segments.find((s) => s.order === segment.order)) {
        return ctx.conflict("A segment with this order already exists");
      } else {
        const entity = await strapi
          .service("api::segment.segment")
          .create({ data: segment });
        const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

        ctx.status = 201;
        return this.transformResponse(sanitizedEntity);
      }
    },
  }),
);
