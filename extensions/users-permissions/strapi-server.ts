export default (plugin: any) => {
  // const originalRegister = plugin.controllers.auth.register;
  //
  // plugin.controllers.auth.register = async (ctx) => {
  //   const { name } = ctx.request.body;
  //
  //   await originalRegister(ctx);
  //
  //   if (ctx.body?.user) {
  //     const user = ctx.body.user;
  //
  //     try {
  //       // Strapi v5 syntax
  //       const judge = await strapi.documents("api::judge.judge").create({
  //         data: {
  //           name: name || user.username,
  //           users_permissions_user: user.documentId, // or user.id depending on your relation setup
  //         },
  //       });
  //
  //       console.log("✅ Judge created:", judge);
  //     } catch (error) {
  //       console.error("❌ Judge creation error:", error);
  //     }
  //   }
  // };
  //
  // return plugin;
};
