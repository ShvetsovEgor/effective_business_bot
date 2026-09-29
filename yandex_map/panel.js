import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { html } from "htm/react";
import {
  Avatar,
  Button,
  CellAction,
  CellHeader,
  CellList,
  CellSimple,
  Container,
  Counter,
  Flex,
  MaxUI,
  Panel,
  Textarea,
  Typography,
} from "@maxhub/max-ui";

const L = window.L;

const PLACEHOLDER = "Кофейня с собой для студентов и офисных сотрудников, аренда до 250 тысяч в месяц, 40–90 м², средний чек 350 ₽, лучше центр или Ново-Савиновский";
const RANK_GRADIENT = ["blue", "purple", "orange", "green", "red"];

const map = L.map("map").setView([55.796, 49.12], 12);
L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/liberty" }).addTo(map);
map.attributionControl.setPrefix("");

const offersLayer = L.layerGroup().addTo(map);
const resultLayer = L.layerGroup().addTo(map);
const competitorLayer = L.layerGroup().addTo(map);
const markers = {};

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const box = L.DomUtil.create("div", "legend");
  box.innerHTML = `
    <div><b>Тепловая карта</b> — пешеходы в сутки по гексагонам Яндекс Геоаналитики</div>
    <div><i style="background:#9aa3af"></i>модельные объявления (симуляция)</div>
    <div><i style="background:#1f6feb"></i>топ-5 мест</div>
    <div><i style="background:#e5484d"></i>конкуренты из Яндекса</div>`;
  return box;
};
legend.addTo(map);

const FLOW_STOPS = [[0, [44, 123, 182]], [0.35, [171, 217, 233]], [0.55, [255, 255, 191]], [0.75, [253, 174, 97]], [1, [215, 25, 28]]];

function flowColor(intensity) {
  const value = Math.max(0, Math.min(1, intensity));
  let left = FLOW_STOPS[0];
  let right = FLOW_STOPS[FLOW_STOPS.length - 1];
  for (let i = 1; i < FLOW_STOPS.length; i++) {
    if (value <= FLOW_STOPS[i][0]) {
      left = FLOW_STOPS[i - 1];
      right = FLOW_STOPS[i];
      break;
    }
  }
  const span = right[0] - left[0] || 1;
  const mix = (value - left[0]) / span;
  const channel = (index) => Math.round(left[1][index] + (right[1][index] - left[1][index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

const rub = (value) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const pct = (value) => value == null ? "—" : `${Math.round(value * 100)} %`;
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function initials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "•";
}

function verdictColor(value) {
  if (value === "подходит") return "var(--icon-positive, #1abe43)";
  if (value === "не брать") return "var(--text-negative, #ff303c)";
  return "#c47b00";
}

function showCompetitors(place) {
  competitorLayer.clearLayers();
  for (const org of place.competitors) {
    L.circleMarker([org.lat, org.lon], { radius: 6, color: "#b42318", fillColor: "#e5484d", fillOpacity: 0.9, weight: 1 })
      .bindPopup(`<b>${esc(org.name)}</b>${org.chain ? " · сеть" : ""}<br>${esc(org.address)}<br>${esc(org.categories.join(", "))}<br>${esc(org.hours)}<br>${org.distance_m} м от помещения`)
      .addTo(competitorLayer);
  }
}

function Verdict({ value }) {
  return html`<${Typography.Label} variant="medium-strong" style=${{ color: verdictColor(value) }}>${value}<//>`;
}

function RankAvatar({ rank }) {
  return html`
    <${Avatar.Container} size=${40} form="squircle">
      <${Avatar.Text} gradient=${RANK_GRADIENT[(rank - 1) % RANK_GRADIENT.length]}>${rank}<//>
    <//>
  `;
}

function OrgAvatar({ name, index }) {
  return html`
    <${Avatar.Container} size=${36} form="circle">
      <${Avatar.Text} gradient=${RANK_GRADIENT[index % RANK_GRADIENT.length]}>${initials(name)}<//>
    <//>
  `;
}

function FinanceRows({ place }) {
  const finance = place.finance;
  const price = place.deal === "rent"
    ? `${rub(place.price_month)}/мес`
    : `${rub(place.price_total)} (${rub(finance.occupancy_month)}/мес как 1 % цены)`;
  const rows = [
    ["Помещение", `${place.area_m2} м², ${price}`],
    ["Прохожих в день (модель)", finance.pedestrians_day.toLocaleString("ru-RU")],
    ["Покупателей в день", finance.visitors_day.toLocaleString("ru-RU")],
    ["Средний чек", rub(finance.avg_check_rub)],
    ["Выручка в месяц", rub(finance.revenue_month)],
    ["Помещение в месяц", `${rub(finance.occupancy_month)} · ${pct(finance.occupancy_share)} выручки`],
    ["Прочие расходы", rub(finance.opex_month)],
    ["Прибыль в месяц", rub(finance.profit_month)],
    ["Вложения на старт", rub(finance.capex)],
    ["Окупаемость", finance.payback_months ? `${finance.payback_months} мес` : "не окупается"],
    ["Аренда на 1000 прохожих", rub(finance.rent_per_1000_pedestrians)],
  ];
  return rows.map(([title, value], index) => html`
    <${CellSimple} key=${title} height="compact" separator=${index < rows.length - 1}
      title=${title}
      after=${html`<${Typography.Body} variant="small-strong">${value}<//>`} />
  `);
}

function BulletCells({ overline, items }) {
  if (!items?.length) return null;
  return items.map((item, index) => html`
    <${CellSimple} key=${`${overline}-${index}`} height="compact" overline=${index === 0 ? overline : undefined} title=${item} />
  `);
}

function InsightBlock({ insight, open, newsOpen, onToggle, onToggleNews }) {
  if (!insight) {
    return html`<${CellSimple} height="compact" title="Ищу новости района и готовлю вывод…" subtitle="Нейропоиск по адресу" />`;
  }
  if (insight.error) {
    return html`<${CellSimple} height="compact" title="Вывод не получен" subtitle=${insight.error} />`;
  }
  const verdict = insight.verdict || {};
  const sources = (insight.sources || []).filter((source) => source.used);
  return html`
    <${CellAction} mode="secondary" showChevron onClick=${onToggle}>Целесообразность открытия<//>
    ${open ? html`
      ${verdict.summary ? html`<${CellSimple} title=${verdict.summary} />` : null}
      <${BulletCells} overline="Плюсы" items=${verdict.advantages} />
      <${BulletCells} overline="Риски" items=${verdict.risks} />
      <${BulletCells} overline="Из новостей" items=${verdict.news_factors} />
      ${insight.news_text ? html`
        <${CellAction} mode="secondary" showChevron onClick=${onToggleNews}>Новостная сводка по району<//>
        ${newsOpen ? html`
          <${CellSimple} title=${insight.news_text} />
          ${sources.map((source) => html`
            <${CellSimple} key=${source.url} height="compact" title=${source.title || source.url} link=${source.url} showChevron />
          `)}
        ` : null}
      ` : null}
    ` : null}
  `;
}

function PlaceCard({ place, active, expanded, insight, open, newsOpen, onFocus, onToggleCard, onToggle, onToggleNews }) {
  const shownVerdict = insight?.verdict?.verdict || place.verdict;
  const competition = place.competition;
  const nearby = Object.entries(place.footfall.nearby).map(([name, count]) => `${name}: ${count}`).join(", ");
  const scores = `Поток ${Math.round(place.scores.footfall * 100)} · экономика ${Math.round(place.scores.finance * 100)} · конкуренция ${Math.round(place.scores.competition * 100)} · соответствие ${Math.round(place.scores.fit * 100)}`;
  return html`
    <div className=${active ? "place-card active" : "place-card"} id=${`place-${place.id}`}>
      <${CellList} mode="island" filled>
        <${CellSimple}
          title=${place.title}
          subtitle=${`${place.address}, ${place.district} район`}
          overline=${`Балл ${Math.round(place.scores.total * 100)}`}
          before=${html`<${RankAvatar} rank=${place.rank} />`}
          after=${html`<${Verdict} value=${shownVerdict} />`}
          showChevron
          onClick=${() => { onToggleCard(); if (!expanded) onFocus(place); }} />
        ${expanded ? html`
        <${CellSimple} height="compact" title=${scores} />
        ${place.flags.length ? html`<${CellSimple} height="compact" overline="Оговорки" title=${place.flags.join("; ")} />` : null}
        <${CellAction} mode="secondary" showChevron onClick=${() => onToggle("finance")}>Финансовая модель: проходимость × аренда<//>
        ${open.finance ? html`<${FinanceRows} place=${place} />` : null}
        <${CellAction} mode="secondary" showChevron onClick=${() => onToggle("competitors")}>
          Конкуренты: ${competition.count} в ${competition.radius_m} м${competition.nearest_m == null ? "" : `, ближайший ${competition.nearest_m} м`}
        <//>
        ${open.competitors ? html`
          ${competition.notes.map((note) => html`<${CellSimple} key=${note} height="compact" title=${note} />`)}
          ${place.competitors.length
            ? place.competitors.slice(0, 8).map((org, index) => html`
                <${CellSimple} key=${org.id || org.name} height="compact"
                  before=${html`<${OrgAvatar} name=${org.name} index=${index} />`}
                  title=${`${org.name}${org.chain ? " · сеть" : ""}`}
                  subtitle=${`${org.distance_m} м · ${org.categories.join(", ")}${org.hours ? ` · ${org.hours}` : ""}`} />
              `)
            : html`<${CellSimple} height="compact" title="Конкурентов в радиусе не найдено" />`}
        ` : null}
        <${CellAction} mode="secondary" showChevron onClick=${() => onToggle("footfall")}>
          Пешеходы: ${place.footfall.pedestrians_day.toLocaleString("ru-RU")} в сутки
        <//>
        ${open.footfall ? html`
          <${CellSimple} height="compact" title=${nearby || "Гексагон без данных о потоке"}${place.metro ? `. Метро: ${place.metro}` : ""} />
        ` : null}
        <${InsightBlock} insight=${insight} open=${open.insight} newsOpen=${newsOpen} onToggle=${() => onToggle("insight")} onToggleNews=${onToggleNews} />
        ` : null}
      <//>
    </div>
  `;
}

function BriefBlock({ brief, showJson, onToggleJson }) {
  const [expanded, setExpanded] = useState(false);
  const deal = { rent: "аренда", sale: "покупка", any: "аренда или покупка" }[brief.deal];
  const chips = [
    brief.business_type,
    deal,
    brief.budget_month_rub ? `до ${rub(brief.budget_month_rub)}/мес` : "",
    brief.budget_total_rub ? `до ${rub(brief.budget_total_rub)}` : "",
    brief.area_min_m2 || brief.area_max_m2 ? `${brief.area_min_m2 ?? "…"}–${brief.area_max_m2 ?? "…"} м²` : "",
    brief.avg_check_rub ? `чек ${rub(brief.avg_check_rub)}` : "",
    brief.needs_food ? "нужна кухня" : "",
    `конкуренты в ${brief.competitor_radius_m} м`,
    ...brief.districts,
  ].filter(Boolean);
  return html`
    <${CellList} mode="island" filled>
      <${CellAction} mode="secondary" showChevron onClick=${() => setExpanded((value) => !value)}>
        Как понят запрос
      <//>
      ${expanded ? html`
        ${chips.map((chip, index) => html`<${CellSimple} key=${`${chip}-${index}`} height="compact" title=${chip} />`)}
        <${CellSimple} height="compact" title="Поиск конкурентов" subtitle=${`${brief.competitor_queries.join(", ")}. Разбор: ${brief.parser === "llm" ? "LLM" : "по ключевым словам"}.`} />
        <${CellAction} mode="secondary" showChevron onClick=${onToggleJson}>JSON запроса<//>
        ${showJson ? html`<${CellSimple} title=${JSON.stringify(brief, null, 2)} />` : null}
      ` : null}
    <//>
  `;
}

function App() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Загружаю тепловую карту проходимости…");
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState(null);
  const [insights, setInsights] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [open, setOpen] = useState({});
  const [showJson, setShowJson] = useState(false);

  async function run(raw) {
    const query = (raw || "").trim() || PLACEHOLDER;
    setText(query);
    setBusy(true);
    setInsights({});
    setOpen({});
    setStatus("Разбираю описание, ищу конкурентов и считаю экономику…");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "ошибка анализа");
      setPayload(body);
      setStatus("Готово. Новости и выводы по каждому месту подгружаются.");
    } catch (error) {
      setStatus(`Не получилось: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function focusPlace(place) {
    setActiveId(place.id);
    map.flyTo([place.lat, place.lon], 16, { duration: 0.6 });
    markers[place.id]?.openPopup();
    showCompetitors(place);
  }

  function toggle(id, section) {
    const key = `${id}:${section}`;
    setOpen((current) => {
      const previous = current[key];
      const wasOpen = Boolean(previous);
      return { ...current, [key]: !wasOpen };
    });
  }

  useEffect(() => {
    window.businessPanel = {
      submit(value) {
        map.invalidateSize();
        run(value);
      },
    };
  });

  useEffect(() => {
    let cancelled = false;
    async function loadHeat() {
      const response = await fetch("/api/heat");
      const body = await response.json();
      if (cancelled) return;
      if (body.status === "building") {
        setStatus("Загружаю пешеходный поток по гексагонам…");
        setTimeout(loadHeat, 4000);
        return;
      }
      if (body.status !== "ready") {
        setStatus(`Тепловая карта недоступна: ${body.error || "ошибка"}`);
        return;
      }
      const layer = L.layerGroup().addTo(map);
      for (const hex of body.hexes) {
        const polygon = L.polygon(hex.boundary, {
          stroke: false,
          fillColor: flowColor(hex.intensity),
          fillOpacity: 0.28 + 0.42 * hex.intensity,
        });
        polygon.bindTooltip(`${hex.pedestrians.toLocaleString("ru-RU")} пешеходов в сутки`, { sticky: true });
        polygon.addTo(layer);
      }
      setStatus(`Тепловая карта: пешеходный поток по ${body.hexes.length} гексагонам, данные на ${body.generated_at}.`);
    }
    async function loadOffers() {
      const body = await (await fetch("/api/offers")).json();
      for (const offer of body.offers) {
        const price = offer.deal === "rent" ? `${rub(offer.price_month)}/мес` : rub(offer.price_total);
        L.circleMarker([offer.lat, offer.lon], { radius: 5, color: "#6b7280", fillColor: "#9aa3af", fillOpacity: 0.8, weight: 1 })
          .bindPopup(`<b>${esc(offer.title)}</b><br>${esc(offer.address)}<br>${price}<br><span class="muted">Симуляция объявления</span>`)
          .addTo(offersLayer);
      }
    }
    loadHeat();
    loadOffers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    resultLayer.clearLayers();
    competitorLayer.clearLayers();
    if (!payload) return undefined;
    const bounds = [];
    for (const place of payload.top) {
      const icon = L.divIcon({ className: "", html: `<div class="num-icon">${place.rank}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      markers[place.id] = L.marker([place.lat, place.lon], { icon, zIndexOffset: 1000 })
        .bindPopup(`<b>${place.rank}. ${esc(place.title)}</b><br>${esc(place.address)}<br>Прибыль (модель): ${rub(place.finance.profit_month)}/мес`)
        .on("click", () => {
          setActiveId(place.id);
          map.flyTo([place.lat, place.lon], 16, { duration: 0.6 });
          showCompetitors(place);
          document.getElementById(`place-${place.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        })
        .addTo(resultLayer);
      L.circle([place.lat, place.lon], { radius: payload.brief.competitor_radius_m, color: "#1f6feb", weight: 1, fillOpacity: 0.04 }).addTo(resultLayer);
      bounds.push([place.lat, place.lon]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });

    let cancelled = false;
    for (const place of payload.top) {
      fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: payload.brief, place }),
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "ошибка");
          if (!cancelled) setInsights((current) => ({ ...current, [place.id]: body }));
        })
        .catch((error) => {
          if (!cancelled) setInsights((current) => ({ ...current, [place.id]: { error: error.message } }));
        });
    }
    return () => { cancelled = true; };
  }, [payload]);

  const sectionOpen = (id, section) => Boolean(open[`${id}:${section}`]);

  return html`
    <${MaxUI} platform="ios" colorScheme="light">
      <${Panel} mode="secondary">
        <${Container}>
          <${Flex} direction="column" align="stretch" gap=${12} style=${{ padding: "16px 0" }}>
            <${Typography.Headline} variant="small">Где открыть бизнес в Казани<//>
            <${Typography.Body} variant="small">Опишите бизнес: формат, бюджет, площадь, аренда или покупка, районы.<//>
            <${Textarea} className="sidebar-field" mode="secondary" rows=${6} value=${text} placeholder=${PLACEHOLDER} onChange=${(event) => setText(event.target.value)} style=${{ minHeight: "132px" }} />
            <${Button} stretched size="large" variant="primary" loading=${busy} disabled=${busy} onClick=${() => run(text)}>Подобрать места<//>
            <${Typography.Text} variant="note" color="secondary">${status}<//>
          <//>
        <//>
        <${Flex} direction="column" gap=${12} style=${{ paddingBottom: 28 }}>
          ${payload ? html`
            <${BriefBlock} brief=${payload.brief} showJson=${showJson} onToggleJson=${() => setShowJson((value) => !value)} />
            <${CellHeader} fullWidth after=${html`<${Counter} value=${payload.top.length} rounded />`}>
              Топ-${payload.top.length} из ${payload.considered} объявлений
            <//>
            <${Container}>
              <${Typography.Text} variant="note" color="secondary">
                Конкуренты проверены у ${payload.searched} лучших по потоку и экономике. Балл: поток 30 %, экономика 35 %, конкуренция 20 %, соответствие запросу 15 %.
              <//>
              ${payload.notes.map((note) => html`<div key=${note}><${Typography.Text} variant="note" color="secondary">${note}<//></div>`)}
            <//>
            ${payload.top.map((place) => html`
              <${PlaceCard}
                key=${place.id}
                place=${place}
                active=${place.id === activeId}
                expanded=${Boolean(open[`${place.id}:card`])}
                insight=${insights[place.id]}
                newsOpen=${Boolean(open[`${place.id}:news`])}
                open=${{
                  finance: sectionOpen(place.id, "finance"),
                  competitors: sectionOpen(place.id, "competitors"),
                  footfall: sectionOpen(place.id, "footfall"),
                  insight: sectionOpen(place.id, "insight"),
                }}
                onFocus=${focusPlace}
                onToggleCard=${() => toggle(place.id, "card")}
                onToggle=${(section) => toggle(place.id, section)}
                onToggleNews=${() => toggle(place.id, "news")} />
            `)}
            <${Container}>
              ${Object.values(payload.notices).map((note) => html`
                <${Typography.Text} key=${note.slice(0, 24)} variant="note" color="tertiary">${note}<//>
              `)}
            <//>
          ` : null}
        <//>
      <//>
    <//>
  `;
}

createRoot(document.getElementById("panel")).render(html`<${App} />`);
