/**
 * participant controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::participant.participant",
  ({ strapi }) => ({
    async customCreate(ctx) {
      const { data } = ctx.request.body;

      if (!data || !data.gender || !data.number || !data.event) {
        return ctx.badRequest("Missing required fields: gender, number, event");
      }

      const { gender, number, event } = data;

      const existingParticipant = await strapi.db
        .query("api::participant.participant")
        .findOne({
          where: {
            gender,
            number,
            event,
          },
        });

      if (existingParticipant) {
        return ctx.conflict(
          "Participant with the same gender and number already exists in this event.",
        );
      }

      const entity = await strapi
        .service("api::participant.participant")
        .create({ data });
      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },
  }),
);
