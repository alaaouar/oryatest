import "server-only";
import { prisma } from "@/lib/prisma";

export const DEMO_TENANT_SLUG = "al-nour";

export async function getDemoTenant() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
  });

  if (!tenant) {
    throw new Error(
      "Établissement de démonstration introuvable. Lancez `npm run db:seed`.",
    );
  }

  return tenant;
}
