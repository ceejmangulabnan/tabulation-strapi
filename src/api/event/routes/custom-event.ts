export default {
  routes: [
    {
      method: "POST",
      path: "/events/test",
      handler: "event.testAction",
    },
    {
      method: "PUT",
      path: "/events/activate",
      handler: "event.activateEvent",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/segments/:segmentId/categories/:categoryId/ranking",
      handler: "event.getCategoryRank",
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/segments/:segmentId/ranking",
      handler: "event.getSegmentRank",
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/ranking",
      handler: "event.getFinalRank",
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/segments/:segmentId/categories/:categoryId/judge-scores",
      handler: "event.getCategoryScoresPerJudge",
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/segments/:segmentId/scores",
      handler: "event.getSegmentScores",
    },
    {
      method: "GET",
      path: "/admin/events/:eventId/scores",
      handler: "event.getFinalScores",
    },
    {
      method: "GET",
      path: "/judge/events/:eventId/scores",
      handler: "event.getFinalScoresForJudge",
    },
  ],
};
