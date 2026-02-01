export default {
  routes: [
    {
      method: "POST",
      path: "/scores/test",
      handler: "score.testAction",
    },
    {
      method: "POST",
      path: "/scores/create",
      handler: "score.createScore",
    },
    {
      method: "PUT",
      path: "/scores/update/:scoreId",
      handler: "score.updateScore",
    },
  ],
};

