import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { Annual } from "./types";
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);
const labels = {
  heatwave_days: "Heatwave days",
  events: "Events starting in year",
  longest_duration: "Longest within-year duration (days)",
};
export default function TrendChart({
  annual,
  metric,
}: {
  annual: Annual[];
  metric: keyof typeof labels;
}) {
  return (
    <div className="chart">
      <Line
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: "index", intersect: false },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: labels[metric] },
            },
          },
          plugins: { legend: { position: "bottom" } },
        }}
        data={{
          labels: annual.map((r) => r.year),
          datasets: [
            {
              label: labels[metric] + " (≥90% coverage)",
              data: annual.map((r) => (r.eligible ? r[metric] : null)),
              borderColor: "#b34724",
              backgroundColor: "#b34724",
              pointRadius: 3,
              spanGaps: false,
            },
            ...(metric === "heatwave_days"
              ? [
                  {
                    label: "5-year trailing mean",
                    data: annual.map((r) => r.rolling_days),
                    borderColor: "#286978",
                    backgroundColor: "#286978",
                    pointRadius: 0,
                    spanGaps: false,
                  },
                ]
              : []),
          ],
        }}
      />
    </div>
  );
}
