import { PageHead } from "@/components/page-head"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { pct } from "@/lib/format"
import { useSession } from "@/lib/session"

const f = (v: number | null | undefined, d = 1) =>
  v == null ? "–" : `${(v * 100).toFixed(d)}%`

export function ModelPage() {
  const { model } = useSession()

  if (!model) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const t = model.test_metrics ?? {}
  const c = model.conformal ?? {}
  const ext = model.external_validation

  const metrics: [string, string][] = [
    ["Accuracy", f(t.accuracy)],
    ["AUC", t.auc == null ? "–" : t.auc.toFixed(3)],
    ["Sensitivity", f(t.sensitivity)],
    ["Specificity", f(t.specificity)],
  ]

  const kv: [string, string][] = [
    [
      "AUC 95% interval",
      t.auc_95ci
        ? `${t.auc_95ci[0].toFixed(3)} to ${t.auc_95ci[1].toFixed(3)}`
        : "–",
    ],
    ["Decision threshold", pct(model.threshold, 1)],
    [
      "Referral band",
      `${pct(model.band.refer_low, 1)} to ${pct(model.band.refer_high, 1)}`,
    ],
    [
      "Prediction-set coverage",
      c.coverage != null
        ? `${f(c.coverage)} (target ${pct(1 - model.alpha)})`
        : "–",
    ],
    ["Patients given a single label", f(c.decisive_rate)],
    ["Accuracy on those patients", f(c.accuracy_on_decisive)],
    ["Brier score", t.brier == null ? "–" : t.brier.toFixed(4)],
  ]

  return (
    <div className="view-enter flex flex-col gap-6">
      <PageHead
        title={model.model_name ?? "Model"}
        description={`Trained on ${model.trained_on ?? "the training split"}. Missing cholesterol handled by ${
          model.impute === "regress"
            ? "regression imputation"
            : (model.impute ?? "imputation")
        }.`}
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Held-out test performance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {metrics.map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted p-3">
                  <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {label}
                  </span>
                  <b className="text-2xl font-extrabold">{value}</b>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
              {kv.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance at a hospital it never saw</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {ext ? (
              <>
                <p className="text-muted-foreground">
                  {ext.description} Mean AUC across hospitals{" "}
                  {ext.mean_auc.toFixed(3)}, against about{" "}
                  {t.auc ? t.auc.toFixed(2) : "0.93"} on patients from the
                  training hospitals. Expect lower performance, and recalibrate,
                  at a new site.
                </p>
                <div className="flex flex-col gap-3">
                  {Object.entries(ext.per_site).map(([site, auc]) => (
                    <div key={site} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-sm">{site}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${((auc - 0.5) / 0.5) * 100}%` }}
                        />
                      </span>
                      <b className="w-12 text-right text-sm">
                        {auc.toFixed(3)}
                      </b>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  Bars start at AUC 0.5 (chance).
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                No external validation is recorded for this model.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>How to read a result</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-muted-foreground">
            <p>
              <b className="text-foreground">Probability</b> is the
              ensemble&apos;s estimate that the patient has heart disease. The{" "}
              <b className="text-foreground">prediction</b> applies the decision
              threshold, which was chosen on training data and favours catching
              disease (high sensitivity).
            </p>
            <p>
              <b className="text-foreground">Uncertainty</b> comes from
              conformal prediction. Inside the amber referral band the
              model&apos;s 90% prediction set contains both outcomes, so the
              case is marked for clinician review instead of a single label.
            </p>
            <p>
              <b className="text-foreground">Explanations</b> are SHAP values:
              each input&apos;s contribution, in percentage points, that moves
              the probability from the average training patient to this patient.
              They describe the model&apos;s reasoning, not medical causation.
            </p>
            <p>
              Research prototype for academic use. Not a medical device and not
              validated for diagnosis. Before use at a new hospital, recalibrate
              to that hospital&apos;s disease rate.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
