import type { Core } from "@strapi/strapi";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  // Commented to try out strapi-server approach
  // bootstrap({ strapi }: { strapi: Core.Strapi }) {
  //   strapi.db.lifecycles.subscribe({
  //     models: ["plugin::users-permissions.user"],
  //
  //     async afterCreate(event: any) {
  //       const { result } = event;
  //       console.log(
  //         "User Register Result in afterCreate lifecycle hook",
  //         result,
  //       );
  //
  //       await strapi.documents("api::judge.judge").create({
  //         data: {
  //           name: result.name,
  //           users_permissions_user: result.id,
  //         },
  //       });
  //     },
  //   });
  // },
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    strapi.db.lifecycles.subscribe({
      models: ["plugin::users-permissions.user"],
      async afterCreate(event: any) {
        const { result, params } = event;

        console.log("User created:", result);
        console.log("Original params:", params);

        // The name will be in params.data
        const name = params.data?.name;
        const eventId = params.data?.eventId;

        const newJudge = await strapi.documents("api::judge.judge").create({
          data: {
            name: name ?? result.username, // Fallback to username if name not provided
            users_permissions_user: result.id,
          },
        });

        const updatedJudge = await strapi.documents("api::judge.judge").update({
          documentId: newJudge.documentId,
          data: {
            events: {
              connect: [eventId],
            },
          },
        });

        console.log("Judge created for user:", result.username);
        console.log("Judge added to event:", newJudge, updatedJudge);
      },
    });
  },
};
