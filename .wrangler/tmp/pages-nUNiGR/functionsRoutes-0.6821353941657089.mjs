import { onRequestGet as __health_js_onRequestGet } from "C:\\Users\\e1it3\\Desktop\\program\\binance_alert\\functions\\health.js"
import { onRequestGet as __price_js_onRequestGet } from "C:\\Users\\e1it3\\Desktop\\program\\binance_alert\\functions\\price.js"
import { onRequestPost as __send_alert_js_onRequestPost } from "C:\\Users\\e1it3\\Desktop\\program\\binance_alert\\functions\\send-alert.js"

export const routes = [
    {
      routePath: "/health",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__health_js_onRequestGet],
    },
  {
      routePath: "/price",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__price_js_onRequestGet],
    },
  {
      routePath: "/send-alert",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__send_alert_js_onRequestPost],
    },
  ]