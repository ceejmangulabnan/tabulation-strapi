export default {
  routes: [
    {
      method: "POST",
      path: "/participants/create",
      handler: "participant.customCreate",
    },
  ],
};
