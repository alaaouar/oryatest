import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import { decryptSecret } from "../src/core/crypto";

const directUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://orya_owner:IFrLw3_m46woLCvI0mWh04Zg@localhost:5432/orya_v2?schema=public";
const key = process.env.MFA_ENCRYPTION_KEY ?? "2hBX4m1IDYD5oFp6Ay1fNCQ98TgHVaeAMhlQLJGEobY=";

const prisma = new PrismaClient({ datasourceUrl: directUrl });

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "direction@atlas.orya.test" },
  });

  if (!user) {
    console.log("Utilisateur non trouvé");
    return;
  }

  console.log("MFA status:", {
    mfaEnrolledAt: user.mfaEnrolledAt,
    hasSecret: Boolean(user.mfaSecret),
  });

  if (user.mfaSecret) {
    const plainSecret = decryptSecret(user.mfaSecret, key);
    const token = authenticator.generate(plainSecret);
    console.log("Clé secrète (base32) :", plainSecret);
    console.log("Code TOTP actuel (valable ~30s) :", token);
  } else {
    console.log("Aucun secret MFA configuré pour cet utilisateur.");
  }
}

main().finally(() => prisma.$disconnect());
