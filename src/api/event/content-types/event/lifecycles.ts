
module.exports = {
  async beforeDelete(event) {
    const { where } = event.params;

    // Find all events that are about to be deleted
    const eventsToDelete = await strapi.db.query('api::event.event').findMany({ where });

    if (eventsToDelete.length === 0) {
      return;
    }

    const eventIds = eventsToDelete.map((e) => e.id);

    // Delete related participants
    await strapi.db.query('api::participant.participant').deleteMany({
      where: { event: { id: { $in: eventIds } } },
    });

    // Delete related scores
    await strapi.db.query('api::score.score').deleteMany({
      where: { event: { id: { $in: eventIds } } },
    });

    // Delete related judge-requests
    await strapi.db.query('api::judge-request.judge-request').deleteMany({
      where: { event: { id: { $in: eventIds } } },
    });

    // Delete related segments
    await strapi.db.query('api::segment.segment').deleteMany({
      where: { event: { id: { $in: eventIds } } },
    });
  },
};
