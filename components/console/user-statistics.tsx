import { BarChart } from "@/components/charts/bar-chart";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import type {
  ConsumptionSeries,
  UsageSeries,
} from "@/lib/subscription/consumption";
import type { ApiEnvironment } from "@/lib/db/schema";
import {
  GRANULARITIES,
  type Granularity,
} from "@/lib/subscription/series";

export function UserStatistics({
  environment,
  from,
  to,
  granularity,
  consumption,
  usage,
  error,
}: {
  environment: ApiEnvironment;
  from: Date;
  to: Date;
  granularity: Granularity;
  consumption: ConsumptionSeries | null;
  usage: UsageSeries | null;
  error?: string;
}) {
  const consumptionGroups = consumption?.groups ?? [];
  const usageGroups = usage?.groups ?? [];
  const consumptionTotals = consumption
    ? sumConsumption(consumption)
    : { spent: 0, granted: 0, net: 0, entryCount: 0 };
  const usageTotals = usage
    ? sumUsage(usage)
    : { amount: 0, consumed: 0, eventCount: 0, chargedUnits: 0 };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Activity range"
          description="Consumption and usage use the same UTC range and bucket size."
        />
        <form method="get" className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="environment" value={environment} />
          <Field label="Start time (UTC)">
            <Input
              type="datetime-local"
              name="statsFrom"
              defaultValue={dateTimeInputValue(from)}
              required
            />
          </Field>
          <Field label="End time (UTC)">
            <Input
              type="datetime-local"
              name="statsTo"
              defaultValue={dateTimeInputValue(to)}
              required
            />
          </Field>
          <Field label="Granularity">
            <Select name="statsGranularity" defaultValue={granularity}>
              {GRANULARITIES.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Update charts
            </Button>
          </div>
        </form>
        {error ? (
          <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </Card>

      {!error && consumption ? (
        <Card className="p-5">
          <BarChart
            title="Balance consumption"
            description={`${formatNumber(consumptionTotals.spent)} spent · ${formatNumber(
              consumptionTotals.granted,
            )} granted · ${formatSigned(consumptionTotals.net)} net · ${formatNumber(
              consumptionTotals.entryCount,
            )} entries. Grouped by ledger description (usage debits use the model name).`}
            series={
              consumptionGroups.length > 0
                ? consumptionGroups.map((group) => ({
                    label: group.label,
                    points: group.buckets.map((bucket) => ({
                      x: bucketLabel(bucket.start, granularity),
                      y: bucket.spent,
                    })),
                  }))
                : [
                    {
                      label: "Spent",
                      points: consumption.totals.map((bucket) => ({
                        x: bucketLabel(bucket.start, granularity),
                        y: bucket.spent,
                      })),
                    },
                  ]
            }
          />
        </Card>
      ) : null}

      {!error && usage ? (
        <Card className="p-5">
          <BarChart
            title="Usage activity"
            description={`${formatNumber(usageTotals.amount)} net amount · ${formatNumber(
              usageTotals.consumed,
            )} consumed · ${formatNumber(usageTotals.eventCount)} events · ${formatNumber(
              usageTotals.chargedUnits,
            )} charged units. Charged units are shown for context and are not added to balance consumption.`}
            series={
              usageGroups.length > 0
                ? usageGroups.map((group) => ({
                    label: `${group.label} (${group.key})`,
                    points: group.buckets.map((bucket) => ({
                      x: bucketLabel(bucket.start, granularity),
                      y: bucket.amount,
                    })),
                  }))
                : [
                    {
                      label: "Amount",
                      points: usage.totals.map((bucket) => ({
                        x: bucketLabel(bucket.start, granularity),
                        y: bucket.amount,
                      })),
                    },
                  ]
            }
          />
        </Card>
      ) : null}
    </div>
  );
}

function sumConsumption(series: ConsumptionSeries) {
  return series.totals.reduce(
    (total, bucket) => ({
      spent: total.spent + bucket.spent,
      granted: total.granted + bucket.granted,
      net: total.net + bucket.net,
      entryCount: total.entryCount + bucket.entryCount,
    }),
    { spent: 0, granted: 0, net: 0, entryCount: 0 },
  );
}

function sumUsage(series: UsageSeries) {
  return series.totals.reduce(
    (total, bucket) => ({
      amount: total.amount + bucket.amount,
      consumed: total.consumed + bucket.consumed,
      eventCount: total.eventCount + bucket.eventCount,
      chargedUnits: total.chargedUnits + bucket.chargedUnits,
    }),
    { amount: 0, consumed: 0, eventCount: 0, chargedUnits: 0 },
  );
}

function dateTimeInputValue(date: Date) {
  return date.toISOString().slice(0, 16);
}

function bucketLabel(start: string, granularity: Granularity) {
  if (granularity === "minute") return start.slice(0, 16).replace("T", " ");
  if (granularity === "hour") return start.slice(0, 13).replace("T", " ") + ":00";
  return start.slice(0, 10);
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}
