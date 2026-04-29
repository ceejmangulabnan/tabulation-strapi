// import type { Core } from '@strapi/strapi';
//
// const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({});
//
// export default config;

const config = ({ env }) => ({
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

export default config;
