/**
 * event controller
 */

import { factories } from "@strapi/strapi";

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

      // if (totalSegmentWeight !== 1.0) {
      //   return ctx.badRequest("Total segment weight must be 1.0");
      // }

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
  }),
);
