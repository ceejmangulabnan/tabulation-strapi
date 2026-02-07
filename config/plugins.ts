export default ({ env }) => ({
  "users-permissions": {
    config: {
      jwt: {
        expiresIn: "7d",
      },
      register: {
        allowedFields: [
          "name",
          "username",
          "email",
          "password",
          "userRole",
          "eventId",
        ],
      },
    },
  },
});
