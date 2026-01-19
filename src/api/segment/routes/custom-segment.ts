export default {
  routes: [
    {
      method: "GET",
      path: "/segments/test",
      handler: "segment.testAction",
    },
    {
      method: "POST",
      path: "/segments/create",
      handler: "segment.customCreate",
    },
  ],
};
