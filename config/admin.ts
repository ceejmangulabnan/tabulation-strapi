export default ({ env }) => {
  console.log("\n=== ADMIN CONFIG DEBUG ===");
  console.log("ADMIN_JWT_SECRET:", !!env("ADMIN_JWT_SECRET"));
  console.log("API_TOKEN_SALT:", !!env("API_TOKEN_SALT"));
  console.log("TRANSFER_TOKEN_SALT:", !!env("TRANSFER_TOKEN_SALT"));
  console.log("ENCRYPTION_KEY:", !!env("ENCRYPTION_KEY"));
  console.log("ENCRYPTION_KEY length:", env("ENCRYPTION_KEY")?.length);
  console.log("========================");

  return {
    auth: {
      secret: env("ADMIN_JWT_SECRET"),
    },
    apiToken: {
      salt: env("API_TOKEN_SALT"),
    },
    transfer: {
      token: {
        salt: env("TRANSFER_TOKEN_SALT"),
      },
    },
    secrets: {
      encryptionKey: env("ENCRYPTION_KEY"),
    },
    flags: {
      nps: env.bool("FLAG_NPS", true),
      promoteEE: env.bool("FLAG_PROMOTE_EE", true),
    },
  };
};
