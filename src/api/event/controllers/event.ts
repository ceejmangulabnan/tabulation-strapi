/**
 * event controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController("api::event.event", () => ({
  // Test Route
  async testAction(ctx) {
    const { data } = ctx.request.body;
    const queryParams = ctx.request.query;
    const path = ctx.request.path;

    const sanitizedOutput = await this.sanitizeOutput(
      { requestData: data, queryParams, path },
      ctx,
    );

    return this.transformResponse(sanitizedOutput);
  },
}));
