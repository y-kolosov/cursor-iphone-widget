"use strict";

function formatOnDemandUsd(usd) {
  return `On-demand $${usd.toFixed(2)}`;
}

function smallFooter(model) {
  if (model.onDemandUsd != null) {
    return { kind: "on-demand", text: formatOnDemandUsd(model.onDemandUsd) };
  }
  if (typeof model.resetAt === "string" && model.resetAt.length > 0) {
    return { kind: "reset" };
  }
  return { kind: "empty" };
}

module.exports = {
  formatOnDemandUsd,
  smallFooter,
};
