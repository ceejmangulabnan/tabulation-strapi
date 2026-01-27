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
  ],
};
