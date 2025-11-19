"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AuthButtons } from "@/components/AuthButtons";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ContributionFrequency = "annual" | "monthly";

type InvestmentInputs = {
  startingAmount: number;
  contributionAmount: number;
  contributionFrequency: ContributionFrequency;
  annualGrowthRate: number;
  inflationRate: number;
  yearsToGrow: number;
};

type YearlySnapshot = {
  year: number;
  contribution: number;
  growth: number;
  balance: number;
  totalContributions: number;
  realBalance: number;
};

type Scenario = {
  id: string;
  name: string;
  createdAt: string;
  inputs: InvestmentInputs;
};

const defaultInputs: InvestmentInputs = {
  startingAmount: 10000,
  contributionAmount: 500,
  contributionFrequency: "monthly",
  annualGrowthRate: 8,
  inflationRate: 2.5,
  yearsToGrow: 20,
};

export default function Home() {
  const [inputs, setInputs] = useState<InvestmentInputs>(defaultInputs);
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.user?.id;
  const storageKey = session?.user?.email
    ? `scenarios_${session.user.email}`
    : "scenarios_guest";
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [isLoadingScenarios, setIsLoadingScenarios] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioLoadError, setScenarioLoadError] = useState<string | null>(
    null
  );
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const canSaveScenario = isAuthenticated
    ? !isSavingScenario
    : storageReady && !isSavingScenario;

  useEffect(() => {
    if (isAuthenticated) {
      let active = true;
      setIsLoadingScenarios(true);
      setScenarioLoadError(null);
      fetch("/api/scenarios")
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Failed to load cloud scenarios");
          }
          return response.json();
        })
        .then((data: Scenario[]) => {
          if (!active) return;
          setScenarios(data);
        })
        .catch((error) => {
          console.error(error);
          if (!active) return;
          setScenarioLoadError("Unable to load saved scenarios.");
          setScenarios([]);
        })
        .finally(() => {
          if (!active) return;
          setIsLoadingScenarios(false);
          setStorageReady(true);
        });

      return () => {
        active = false;
      };
    }

    if (typeof window === "undefined") return;
    setStorageReady(false);
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Scenario[];
        const normalized = parsed.map((scenario) => ({
          ...scenario,
          createdAt:
            typeof scenario.createdAt === "number"
              ? new Date(scenario.createdAt).toISOString()
              : scenario.createdAt ?? new Date().toISOString(),
        }));
        setScenarios(normalized);
      } catch (error) {
        console.warn("Failed to parse scenarios", error);
        setScenarios([]);
      }
    } else {
      setScenarios([]);
    }
    setScenarioLoadError(null);
    setStorageReady(true);
  }, [isAuthenticated, storageKey]);

  useEffect(() => {
    if (isAuthenticated || !storageReady || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(scenarios));
  }, [isAuthenticated, scenarios, storageReady, storageKey]);

  const summary = useMemo(() => {
    const rows: YearlySnapshot[] = [];
    let balance = inputs.startingAmount;
    let totalContributions = inputs.startingAmount;
    let inflationFactor = 1;

    const monthlyGrowthRate = inputs.annualGrowthRate / 100 / 12;
    const monthlyInflationRate = inputs.inflationRate / 100 / 12;

    for (let year = 1; year <= inputs.yearsToGrow; year++) {
      let contributionThisYear = 0;
      let growthThisYear = 0;

      for (let month = 1; month <= 12; month++) {
        const contribution =
          inputs.contributionFrequency === "monthly"
            ? inputs.contributionAmount
            : month === 1
            ? inputs.contributionAmount
            : 0;

        if (contribution > 0) {
          balance += contribution;
          contributionThisYear += contribution;
          totalContributions += contribution;
        }

        const growth = balance * monthlyGrowthRate;
        balance += growth;
        growthThisYear += growth;

        if (monthlyInflationRate > 0) {
          inflationFactor *= 1 + monthlyInflationRate;
        }
      }

      rows.push({
        year,
        contribution: contributionThisYear,
        growth: growthThisYear,
        balance,
        totalContributions,
        realBalance: balance / inflationFactor,
      });
    }

    const finalBalance = rows.at(-1)?.balance ?? inputs.startingAmount;
    const finalRealBalance = rows.at(-1)?.realBalance ?? finalBalance;

    return {
      rows,
      finalBalance,
      finalRealBalance,
      totalContributions,
      totalGrowth: finalBalance - totalContributions,
    };
  }, [inputs]);

  function handleInputChange(field: keyof InvestmentInputs, value: string) {
    const numericValue = Number(value);
    setInputs((prev) => ({
      ...prev,
      [field]: Number.isNaN(numericValue) ? prev[field] : numericValue,
    }));
  }

  function handleFrequencyChange(value: ContributionFrequency) {
    setInputs((prev) => ({
      ...prev,
      contributionFrequency: value,
    }));
  }

  async function handleSaveScenario() {
    if (typeof window === "undefined") return;
    const name = window.prompt("Name this scenario", "My plan");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (isAuthenticated) {
      try {
        setIsSavingScenario(true);
        setScenarioError(null);
        const response = await fetch("/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, inputs }),
        });
        if (!response.ok) {
          throw new Error("Failed to save scenario");
        }
        const savedScenario: Scenario = await response.json();
        setScenarios((prev) => [savedScenario, ...prev]);
      } catch (error) {
        console.error(error);
        setScenarioError(
          "We couldn't save this scenario. Please try again in a moment."
        );
      } finally {
        setIsSavingScenario(false);
      }
      return;
    }

    if (!storageReady) return;

    const newScenario: Scenario = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
      inputs: { ...inputs },
    };

    setScenarios((prev) => [newScenario, ...prev].slice(0, 10));
  }

  function handleLoadScenario(id: string) {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) return;
    setInputs({ ...scenario.inputs });
  }

  async function handleDeleteScenario(id: string) {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm("Remove this saved scenario?");
    if (!confirmed) return;

    if (isAuthenticated) {
      try {
        setScenarioError(null);
        const response = await fetch(`/api/scenarios/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Failed to delete scenario");
        }
        setScenarios((prev) => prev.filter((scenario) => scenario.id !== id));
      } catch (error) {
        console.error(error);
        setScenarioError("Unable to delete this scenario right now.");
      }
      return;
    }

    setScenarios((prev) => prev.filter((scenario) => scenario.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-900">
      <main className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-indigo-500">
              Wealth Planner
            </p>
            <h1 className="text-3xl font-semibold text-slate-900">
              Investment Growth Simulator
            </h1>
            <p className="text-sm text-slate-500">
              Project your portfolio growth and compare scenarios in minutes.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <AuthButtons />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSaveScenario}
                disabled={!canSaveScenario}
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {isSavingScenario ? "Saving..." : "Save scenario"}
              </button>
              <button
                onClick={() => setInputs(defaultInputs)}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Reset inputs
              </button>
            </div>
            {scenarioError && (
              <p className="text-xs text-rose-500">{scenarioError}</p>
            )}
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[360px,1fr]">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">
              Investment inputs
            </h2>
            <p className="text-sm text-slate-500">
              Tune the assumptions to match your real-world plan.
            </p>
            <div className="mt-6 space-y-5">
              <InputField
                label="Starting amount"
                prefix="$"
                value={inputs.startingAmount}
                onChange={(value) => handleInputChange("startingAmount", value)}
              />
              <InputField
                label={
                  inputs.contributionFrequency === "monthly"
                    ? "Monthly contribution"
                    : "Annual contribution"
                }
                prefix="$"
                value={inputs.contributionAmount}
                onChange={(value) =>
                  handleInputChange("contributionAmount", value)
                }
              />
              <ContributionFrequencyToggle
                value={inputs.contributionFrequency}
                onChange={handleFrequencyChange}
              />
              <InputField
                label="Annual growth rate"
                suffix="%"
                value={inputs.annualGrowthRate}
                onChange={(value) =>
                  handleInputChange("annualGrowthRate", value)
                }
              />
              <InputField
                label="Inflation rate"
                suffix="%"
                value={inputs.inflationRate}
                onChange={(value) => handleInputChange("inflationRate", value)}
              />
              <InputField
                label="Years to grow"
                value={inputs.yearsToGrow}
                onChange={(value) => handleInputChange("yearsToGrow", value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <StatCard
                label="Projected balance"
                value={formatCurrency(summary.finalBalance)}
              />
              <StatCard
                label="Total contributions"
                value={formatCurrency(summary.totalContributions)}
                helperText="Principal invested"
              />
              <StatCard
                label="Total growth"
                value={formatCurrency(summary.totalGrowth)}
                trend="positive"
                helperText="Market-driven gains"
              />
              <StatCard
                label="Inflation-adjusted"
                value={formatCurrency(summary.finalRealBalance)}
                helperText="Today's dollars"
              />
            </div>

            <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-600 p-6 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-wide text-slate-300">
                    Growth preview
                  </p>
                  <p className="text-3xl font-semibold">
                    {formatCurrency(summary.finalBalance)}
                  </p>
                </div>
                <span className="rounded-full bg-white/10 px-4 py-1 text-sm">
                  {inputs.yearsToGrow} yrs
                </span>
              </div>
              <div className="mt-6 h-64 min-h-[16rem] rounded-2xl bg-white/10 p-4">
                <GrowthChart data={summary.rows} />
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Year-by-year snapshot
                  </h3>
                  <p className="text-sm text-slate-500">
                    Detailed breakdown of contributions, growth, and balances.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {summary.rows.length} rows
                </span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2 font-medium">Year</th>
                      <th className="py-2 font-medium">Contribution</th>
                      <th className="py-2 font-medium">Growth</th>
                      <th className="py-2 font-medium">End balance</th>
                      <th className="py-2 font-medium">Real balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row) => (
                      <tr
                        key={row.year}
                        className="border-b border-slate-100 last:border-none"
                      >
                        <td className="py-2 font-medium text-slate-700">
                          Year {row.year}
                        </td>
                        <td className="py-2 text-slate-600">
                          {formatCurrency(row.contribution)}
                        </td>
                        <td className="py-2 text-emerald-600">
                          {formatCurrency(row.growth)}
                        </td>
                        <td className="py-2 font-semibold text-slate-900">
                          {formatCurrency(row.balance)}
                        </td>
                        <td className="py-2 text-slate-600">
                          {formatCurrency(row.realBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {(isAuthenticated || storageReady) && (
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
            <ScenarioList
              scenarios={scenarios}
              loading={isLoadingScenarios}
              error={scenarioLoadError}
              isAuthenticated={isAuthenticated}
              onLoad={handleLoadScenario}
              onDelete={handleDeleteScenario}
            />
          </section>
        )}
      </main>
    </div>
  );
}

type InputFieldProps = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: string) => void;
};

function InputField({
  label,
  value,
  prefix,
  suffix,
  onChange,
}: InputFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-indigo-400 focus-within:bg-white">
        {prefix && <span className="text-slate-400">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent px-2 text-base font-semibold text-slate-900 outline-none"
        />
        {suffix && <span className="text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

type ContributionFrequencyToggleProps = {
  value: ContributionFrequency;
  onChange: (value: ContributionFrequency) => void;
};

function ContributionFrequencyToggle({
  value,
  onChange,
}: ContributionFrequencyToggleProps) {
  const options: { value: ContributionFrequency; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "annual", label: "Annual" },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Contribution frequency
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  trend?: "positive" | "negative";
  helperText?: string;
};

function StatCard({ label, value, trend, helperText }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {trend === "positive" && (
        <p className="mt-1 text-xs font-medium text-emerald-600">
          Compounding working in your favor
        </p>
      )}
      {helperText && (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

type GrowthChartProps = {
  data: YearlySnapshot[];
};

function GrowthChart({ data }: GrowthChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="balanceGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#c7d2fe" stopOpacity={0.9} />
            <stop offset="95%" stopColor="#c7d2fe" stopOpacity={0.15} />
          </linearGradient>
          <linearGradient id="contributionGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#fde68a" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#fde68a" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="year"
          stroke="#c7d2fe"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `Yr ${value}`}
        />
        <YAxis
          stroke="#c7d2fe"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
        />
        <Legend
          verticalAlign="top"
          height={36}
          wrapperStyle={{ paddingTop: 0, color: "#c7d2fe" }}
        />
        <Tooltip
          contentStyle={{
            background: "#0f172a",
            border: "none",
            borderRadius: "0.75rem",
            color: "#fff",
          }}
          formatter={(value: number, name) => {
            const labelMap: Record<string, string> = {
              balance: "Projected balance",
              totalContributions: "Total contributions",
              realBalance: "Inflation-adjusted",
            };
            return [formatCurrency(value), labelMap[name] ?? name];
          }}
          labelFormatter={(label) => `Year ${label}`}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="#e0e7ff"
          strokeWidth={3}
          fill="url(#balanceGradient)"
          name="Projected balance"
        />
        <Area
          type="monotone"
          dataKey="totalContributions"
          stroke="#fbcfe8"
          strokeWidth={2}
          fill="url(#contributionGradient)"
          name="Total contributions"
        />
        <Area
          type="monotone"
          dataKey="realBalance"
          stroke="#a5b4fc"
          strokeWidth={2}
          fillOpacity={0}
          strokeDasharray="6 6"
          name="Inflation-adjusted"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type ScenarioListProps = {
  scenarios: Scenario[];
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
};

function ScenarioList({
  scenarios,
  loading,
  error,
  isAuthenticated,
  onLoad,
  onDelete,
}: ScenarioListProps) {
  const title = isAuthenticated ? "Your saved scenarios" : "Local scenarios";
  const subtitle = isAuthenticated
    ? "Securely synced to your account."
    : "Stored only on this device.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        {loading && (
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
            Syncing…
          </span>
        )}
      </div>
      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-600">
          {error}
        </div>
      )}
      {scenarios.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isAuthenticated
            ? "No cloud scenarios yet—save one above to see it here."
            : "No local scenarios saved. Configure a plan and tap Save."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className="rounded-2xl border border-slate-100 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {scenario.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Saved{" "}
                    {new Date(scenario.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(scenario.id)}
                  className="text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-rose-500"
                >
                  Remove
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                <div>
                  <dt>Contribution</dt>
                  <dd className="font-semibold text-slate-800">
                    {scenario.inputs.contributionFrequency === "monthly"
                      ? "Monthly"
                      : "Annual"}
                  </dd>
                </div>
                <div>
                  <dt>Growth</dt>
                  <dd className="font-semibold text-slate-800">
                    {scenario.inputs.annualGrowthRate}%
                  </dd>
                </div>
                <div>
                  <dt>Inflation</dt>
                  <dd className="font-semibold text-slate-800">
                    {scenario.inputs.inflationRate}%
                  </dd>
                </div>
                <div>
                  <dt>Timeline</dt>
                  <dd className="font-semibold text-slate-800">
                    {scenario.inputs.yearsToGrow} yrs
                  </dd>
                </div>
              </dl>
              <button
                onClick={() => onLoad(scenario.id)}
                className="mt-4 w-full rounded-xl bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Load scenario
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
