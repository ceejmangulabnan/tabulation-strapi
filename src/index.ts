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
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    strapi.db.lifecycles.subscribe({
      models: ["plugin::users-permissions.user"],

      async afterCreate(event: any) {
        const { result } = event;
        console.log(
          "User Register Result in afterCreate lifecycle hook",
          result,
        );

        await strapi.documents("api::judge.judge").create({
          data: {
            name: result.username,
            users_permissions_user: result.id,
          },
        });
      },
    });
  },
};
