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
    {
      method: "PUT",
      path: "/segments/activate",
      handler: "segment.activateSegment",
    },
    {
      method: "POST",
      path: "/segments/:id/lock",
      handler: "segment.lockSegment",
    },
  ],
};
