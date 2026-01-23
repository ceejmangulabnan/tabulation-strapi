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

    async activateSegment(ctx) {
      const body = ctx.request.body as {
        documentId: string;
        data: {
          segment_status: "draft" | "inactive" | "active" | "closed";
        };
      };

      // Check if event is active
      const segment = await strapi.documents("api::segment.segment").findOne({
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
      const { id } = ctx.params;

      try {
        const lockedSegment = await strapi
          .service("api::segment.segment")
          .lockSegment(id);
        const sanitizedOutput = await this.sanitizeOutput(lockedSegment, ctx);
        return this.transformResponse(sanitizedOutput);
      } catch (error) {
        if (error.message.includes("not found")) {
          return ctx.notFound(error.message);
        }
        if (error.message.includes("cannot be locked")) {
          return ctx.badRequest(error.message);
        }
        return ctx.internalServerError("An unexpected error occurred.");
      }
    },
  }),
);
