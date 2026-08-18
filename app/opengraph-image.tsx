import { ImageResponse } from "next/og";
import { BRAND_MARK_DATA_URI } from "@/lib/brand";

export const alt = "RxLab Subscriptions — plans, entitlements, usage, and billing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HIGHLIGHTS = ["Plans", "Entitlements", "Usage", "Billing"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 72,
          backgroundColor: "#020617",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* The glow the console hero carries, minus the blur satori can't do. */}
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -160,
            width: 760,
            height: 760,
            borderRadius: 760,
            backgroundImage:
              "radial-gradient(circle, rgba(37,99,235,0.55) 0%, rgba(2,6,23,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -280,
            left: -120,
            width: 720,
            height: 720,
            borderRadius: 720,
            backgroundImage:
              "radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(2,6,23,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={BRAND_MARK_DATA_URI} width={84} height={84} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>
              RxLab
            </span>
            <span style={{ fontSize: 24, color: "#94a3b8" }}>Subscriptions</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
          }}
        >
          <span
            style={{
              fontSize: 74,
              fontWeight: 700,
              letterSpacing: -2.5,
              lineHeight: 1.05,
              maxWidth: 940,
            }}
          >
            Manage every product from one place.
          </span>
          <span
            style={{
              marginTop: 26,
              fontSize: 30,
              lineHeight: 1.4,
              color: "#94a3b8",
              maxWidth: 860,
            }}
          >
            Configure plans, access, usage, and billing for your applications.
          </span>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 52 }}>
          {HIGHLIGHTS.map((highlight) => (
            <div
              key={highlight}
              style={{
                display: "flex",
                padding: "12px 24px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.28)",
                backgroundColor: "rgba(148,163,184,0.08)",
                fontSize: 24,
                color: "#e2e8f0",
              }}
            >
              {highlight}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
