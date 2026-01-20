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
  ],
};

