import { factories } from '@strapi/strapi';

export default factories.createCoreService(
  "api::segment.segment",
  ({ strapi }) => ({
    async lockSegment(segmentId) {
      // Fetch the segment with necessary relations
      const segment = await strapi.documents("api::segment.segment").findOne({
        documentId: segmentId,
        populate: {
          event: { populate: { participants: true } },
          categories: true,
          scores: { populate: { participant: true, category: true } },
        },
      });

      if (!segment) {
        throw new Error("Segment not found.");
      }

      if (segment.segment_status !== "active") {
        throw new Error("Segment cannot be locked as it is not in 'active' status.");
      }

      // Filter active participants only
      const activeParticipants = segment.event.participants.filter(
        (p) => p.participant_status === "active",
      );

      // Calculate scores for each active participant
      const participantScores = this.calculateSegmentScores(
        activeParticipants,
        segment.scores,
        segment.categories,
      );

      // Determine eliminations based on advancement rule
      const { toEliminate, toAdvance, tieDetected } = this.determineEliminations(
        participantScores,
        segment,
      );

      // WARNING: The following updates are not atomic and may result in
      // partial updates if an error occurs. This is a trade-off for
      // using `strapi.documents()` for type safety.

      // Update eliminated participants
      for (const participant of toEliminate) {
        await strapi.documents("api::participant.participant").update({
          documentId: participant.id,
          data: {
            participant_status: "eliminated",
            eliminated_at_segment: segmentId,
          },
        });
      }

      // Lock the segment
      await strapi.documents("api::segment.segment").update({
        documentId: segmentId,
        data: { segment_status: "closed" },
      });


      // TODO: Report ties if tieDetected is true
      console.log("Tie detected:", tieDetected);

      // Return the updated segment
      return await strapi.documents("api::segment.segment").findOne({
        documentId: segmentId,
      });
    },

    calculateSegmentScores(activeParticipants, scores, categories) {
      const participantScoresMap = new Map();

      for (const participant of activeParticipants) {
        participantScoresMap.set(participant.id, {
          ...participant,
          totalScore: 0,
          categoryScores: {},
        });
      }

      for (const score of scores) {
        const participantEntry = participantScoresMap.get(score.participant.id);
        if (participantEntry) {
          const category = categories.find((cat) => cat.id === score.category.id);
          if (category) {
            const weightedScore = score.value * category.weight;
            participantEntry.totalScore += weightedScore;
            participantEntry.categoryScores[category.name] = weightedScore;
          }
        }
      }

      return Array.from(participantScoresMap.values()).sort(
        (a, b) => b.totalScore - a.totalScore,
      );
    },

    determineEliminations(participantScores, segment) {
      const toEliminate = [];
      const toAdvance = [];
      let tieDetected = false;

      switch (segment.advancement_type) {
        case "all":
          toAdvance.push(...participantScores);
          break;
        case "top_n":
          const N = segment.advancement_value;
          if (N === null || N === undefined) {
            throw new Error("advancement_value must be set for 'top_n' advancement.");
          }

          if (participantScores.length > N) {
            const cutoffScore = participantScores[N - 1].totalScore;
            let participantsAtCutoff = 0;
            for (let i = 0; i < participantScores.length; i++) {
              if (participantScores[i].totalScore >= cutoffScore) {
                toAdvance.push(participantScores[i]);
                if (participantScores[i].totalScore === cutoffScore) {
                  participantsAtCutoff++;
                }
              } else {
                toEliminate.push(participantScores[i]);
              }
            }
            if (participantsAtCutoff > 1 && toAdvance.length > N) {
              tieDetected = true; // Ties exceed N, requires admin confirmation
            }
          } else {
            toAdvance.push(...participantScores);
          }
          break;
        case "threshold":
          const threshold = segment.advancement_value;
          if (threshold === null || threshold === undefined) {
            throw new Error("advancement_value must be set for 'threshold' advancement.");
          }

          let advancedCount = 0;
          for (const participant of participantScores) {
            if (participant.totalScore >= threshold) {
              toAdvance.push(participant);
              advancedCount++;
            } else {
              toEliminate.push(participant);
            }
          }
          if (advancedCount === 0 && participantScores.length > 0) {
            throw new Error("Zero participants advanced. Admin confirmation required.");
          }
          break;
        case "manual":
          // All go to toAdvance, but will require manual selection by admin
          toAdvance.push(...participantScores);
          break;
        default:
          throw new Error(`Unknown advancement type: ${segment.advancement_type}`);
      }

      // This block is redundant and incorrect, as the logic for each
      // advancement_type should handle eliminations correctly.
      // if (segment.advancement_type !== "manual" && segment.advancement_type !== "all") {
      //   const advancedIds = new Set(toAdvance.map((p) => p.id));
      //   for (const participant of participantScores) {
      //     if (!advancedIds.has(participant.id)) {
      //       toEliminate.push(participant);
      //     }
      //   }
      // }


      return { toEliminate, toAdvance, tieDetected };
    },
  }),
);
