import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import prisma from "@/lib/prisma";
import { authOptions } from "../auth/[...nextauth]/route";

const unauthorized = NextResponse.json(
  { error: "Unauthorized" },
  { status: 401 }
);

const badRequest = NextResponse.json(
  { error: "Invalid payload" },
  { status: 400 }
);

const serialize = (scenario: any) => ({
  id: scenario.id,
  name: scenario.name,
  inputs: scenario.inputs,
  createdAt: scenario.createdAt.toISOString(),
});

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized;
  }

  const scenarios = await prisma.scenario.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(scenarios.map(serialize));
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    typeof body.inputs !== "object"
  ) {
    return badRequest;
  }

  const name = body.name.trim().slice(0, 80);

  const scenario = await prisma.scenario.create({
    data: {
      name,
      inputs: body.inputs,
      userId: session.user.id,
    },
  });

  return NextResponse.json(serialize(scenario), { status: 201 });
}

