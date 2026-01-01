// --- Utilities ---
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const pad2 = (n) => String(n).padStart(2, "0");
const toDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDue = (dateStr, timeStr) => {
  if (!dateStr) return null;
  const t = timeStr && timeStr.trim() ? timeStr : "23:59";
  const iso = `${dateStr}T${t}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};
const formatKorean = (d) => {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}(${days[d.getDay()]})`;
};
const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// --- Storage ---
const KEY = "todo_schedule_v1";
const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};
const save = (items) => localStorage.setItem(KEY, JSON.stringify(items));

// --- State ---
let items = load();
let filter = "all";
let search = "";
let sort = "dueAsc";

const isTemplate = (it) => Boolean(it?.template === true);
const isInstance = (it) => Boolean(it?.instance === true);
const nonTemplateItems = () => items.filter((it) => !isTemplate(it));

const getMaxOrder = () => Math.max(0, ...items.map((it) => Number(it.order || 0)));
const clampRepeat = (v) => (["none", "daily", "weekly", "monthly"].includes(v) ? v : "none");

// --- Toast (Bootstrap Toast 우선, 없으면 fallback) ---
let bsToast = null;
const toast = (msg) => {
  const toastEl = $("#appToast");
  const bodyEl = $("#toastBody");
  const bs = window.bootstrap;

  if (toastEl && bodyEl && bs?.Toast) {
    bodyEl.textContent = msg;
    bsToast = bsToast ?? bs.Toast.getOrCreateInstance(toastEl, { delay: 1600 });
    bsToast.show();
    return;
  }

  // fallback
  alert(msg);
};

// --- Notifications ---
const canUseNotifications = () => typeof window !== "undefined" && "Notification" in window;
const requestNotifPermission = async () => {
  if (!canUseNotifications()) {
    toast("이 브라우저는 알림을 지원하지 않아요.");
    return "unsupported";
  }
  try {
    const perm = await Notification.requestPermission();
    toast(perm === "granted" ? "알림이 허용됐어요." : "알림이 차단됐어요(브라우저 설정에서 변경 가능).");
    return perm;
  } catch {
    toast("알림 권한 요청에 실패했어요.");
    return "error";
  }
};

const fireNotification = (title, body, tag) => {
  if (!canUseNotifications() || Notification.permission !== "granted") return false;
  try {
    new Notification(title, { body, tag, silent: false });
    return true;
  } catch {
    return false;
  }
};

// --- Google Tasks Integration (OAuth Token + REST API) ---
const GCFG_KEY = "google_tasks_cfg_v1";
const GTOKEN_KEY = "google_tasks_token_v1";

const loadGoogleCfg = () => {
  try {
    const raw = localStorage.getItem(GCFG_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return {
      clientId: String(obj.clientId || ""),
      tasklistId: String(obj.tasklistId || ""),
    };
  } catch {
    return { clientId: "", tasklistId: "" };
  }
};

const saveGoogleCfg = (cfg) => {
  localStorage.setItem(
    GCFG_KEY,
    JSON.stringify({
      clientId: String(cfg.clientId || ""),
      tasklistId: String(cfg.tasklistId || ""),
    }),
  );
};

const loadGoogleToken = () => {
  try {
    const raw = localStorage.getItem(GTOKEN_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj?.access_token) return null;
    return {
      access_token: String(obj.access_token),
      expires_at: Number(obj.expires_at || 0),
    };
  } catch {
    return null;
  }
};

const saveGoogleToken = (tok) => {
  localStorage.setItem(
    GTOKEN_KEY,
    JSON.stringify({
      access_token: tok.access_token,
      expires_at: tok.expires_at,
    }),
  );
};

const clearGoogleToken = () => localStorage.removeItem(GTOKEN_KEY);

const gCfg = loadGoogleCfg();
let gToken = loadGoogleToken();
let gTokenClient = null;

const gStatusEl = () => $("#gStatus");
const setGStatus = (text) => {
  const el = gStatusEl();
  if (el) el.textContent = text;
};

const isGTokenValid = () => gToken?.access_token && Date.now() < (gToken.expires_at || 0) - 10_000;

const waitForGIS = async (timeoutMs = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.google?.accounts?.oauth2?.initTokenClient) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

const ensureGTokenClient = async () => {
  const ok = await waitForGIS();
  if (!ok) throw new Error("Google Identity Services 로딩 실패");
  if (!gCfg.clientId) throw new Error("Google Client ID가 필요합니다.");

  if (!gTokenClient) {
    gTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: gCfg.clientId,
      scope: "https://www.googleapis.com/auth/tasks",
      callback: (resp) => {
        if (resp?.access_token) {
          gToken = {
            access_token: resp.access_token,
            expires_at: Date.now() + Number(resp.expires_in || 3600) * 1000,
          };
          saveGoogleToken(gToken);
          setGStatus("연결됨(토큰 발급 완료)");
        }
      },
    });
  }
  return gTokenClient;
};

const getAccessToken = async ({ interactive } = { interactive: true }) => {
  if (isGTokenValid()) return gToken.access_token;
  const tc = await ensureGTokenClient();
  return await new Promise((resolve, reject) => {
    const cb = (resp) => {
      if (resp?.error) return reject(new Error(resp.error));
      if (!resp?.access_token) return reject(new Error("토큰 발급 실패"));
      resolve(resp.access_token);
    };
    // callback을 잠깐 바꿔치기(한 번 요청용)
    const prev = tc.callback;
    tc.callback = (resp) => {
      try {
        prev?.(resp);
      } finally {
        cb(resp);
        tc.callback = prev;
      }
    };
    tc.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
};

const gFetch = async (path, opts = {}, { interactive } = { interactive: true }) => {
  const token = await getAccessToken({ interactive });
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && interactive) {
    // 토큰 재요청 후 1회 재시도
    clearGoogleToken();
    gToken = null;
    return await gFetch(path, opts, { interactive: false });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google Tasks API 오류(${res.status}): ${t || res.statusText}`);
  }
  return res.status === 204 ? null : await res.json();
};

const gListTasklists = async () => {
  const data = await gFetch(`/users/@me/lists`, { method: "GET" });
  return Array.isArray(data?.items) ? data.items : [];
};

const gListTasks = async (tasklistId) => {
  const qs = new URLSearchParams({
    maxResults: "100",
    showCompleted: "true",
    showHidden: "true",
  });
  const data = await gFetch(`/lists/${encodeURIComponent(tasklistId)}/tasks?${qs.toString()}`, { method: "GET" });
  return Array.isArray(data?.items) ? data.items : [];
};

const toRfc3339Due = (it) => {
  const d = parseDue(it.date, it.time);
  if (!d) return null;
  return d.toISOString();
};

const stripCursorIdFromNotes = (notes) =>
  String(notes || "")
    .split("\n")
    .filter((line) => !line.startsWith("cursorTodoId:"))
    .join("\n")
    .trim();

const extractCursorIdFromNotes = (notes) => {
  const m = String(notes || "").match(/cursorTodoId:([A-Za-z0-9\-_:.]+)/);
  return m ? m[1] : "";
};

const gExport = async () => {
  if (!gCfg.tasklistId) throw new Error("Task list를 선택해 주세요.");
  // 템플릿은 Google로 내보내지 않음(인스턴스/일반만)
  const base = nonTemplateItems();

  for (const it of base) {
    const payload = {
      title: it.title,
      notes: [stripCursorIdFromNotes(it.notes), `cursorTodoId:${it.id}`].filter(Boolean).join("\n"),
      due: toRfc3339Due(it),
      status: it.done ? "completed" : "needsAction",
    };

    if (!it.googleTaskId) {
      const created = await gFetch(`/lists/${encodeURIComponent(gCfg.tasklistId)}/tasks`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      it.googleTaskId = created?.id || "";
      it.updatedAt = Date.now();
    } else {
      await gFetch(`/lists/${encodeURIComponent(gCfg.tasklistId)}/tasks/${encodeURIComponent(it.googleTaskId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    }
  }

  save(items);
  renderAll();
  toast("Google Tasks로 내보냈어요.");
};

const gImport = async () => {
  if (!gCfg.tasklistId) throw new Error("Task list를 선택해 주세요.");
  const tasks = await gListTasks(gCfg.tasklistId);

  const byCursorId = new Map(nonTemplateItems().map((it) => [it.id, it]));
  const byGoogleId = new Map(nonTemplateItems().filter((it) => it.googleTaskId).map((it) => [it.googleTaskId, it]));

  tasks.forEach((t) => {
    if (!t?.id || !t?.title) return;
    const cursorId = extractCursorIdFromNotes(t.notes);

    const due = t.due ? new Date(t.due) : null;
    const date = due && !isNaN(due.getTime()) ? toDateKey(due) : "";
    const time = due && !isNaN(due.getTime()) ? `${pad2(due.getHours())}:${pad2(due.getMinutes())}` : "";
    const done = t.status === "completed";

    const notes = stripCursorIdFromNotes(t.notes);

    const target = (cursorId && byCursorId.get(cursorId)) || byGoogleId.get(t.id);
    if (target) {
      target.title = String(t.title || "").trim() || target.title;
      target.date = date;
      target.time = time;
      target.done = done;
      target.notes = notes;
      target.googleTaskId = t.id;
      target.updatedAt = Date.now();
    } else {
      addItem({
        title: String(t.title || "").trim() || "제목 없음",
        date,
        time,
        priority: 1,
        category: "",
        notes,
        repeat: "none",
        notifyEnabled: false,
        notifyMins: 5,
        template: false,
        instance: false,
        parentId: "",
      }).googleTaskId = t.id;
    }
  });

  save(items);
  renderAll();
  toast("Google Tasks에서 가져왔어요.");
};

const gSync = async () => {
  await gImport();
  await gExport();
};

const gRefreshTasklistsUI = async () => {
  const sel = $("#gTasklist");
  if (!sel) return;
  sel.innerHTML = `<option value="">불러오는 중…</option>`;
  const lists = await gListTasklists();
  sel.innerHTML = `<option value="">선택하세요</option>` + lists.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title || l.id)}</option>`).join("");
  if (gCfg.tasklistId) sel.value = gCfg.tasklistId;
};

// --- Derived statuses ---
const now = () => new Date();
const getStatus = (it, nowD = new Date()) => {
  if (it.done) return "done";
  const due = parseDue(it.date, it.time);
  if (!due) return "plain";
  if (toDateKey(due) === toDateKey(nowD)) return "today";
  if (due.getTime() < nowD.getTime()) return "overdue";
  return "upcoming";
};

// --- Render ---
const renderTop = () => {
  const d = now();
  $("#nowPill b").textContent = formatKorean(d);
  $("#nowText").textContent = `현재 ${formatTime(d)}`;
};

const applyFilterSortSearch = () => {
  const nowD = now();
  let arr = [...nonTemplateItems()];

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    arr = arr.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.category || "").toLowerCase().includes(q) ||
        (it.notes || "").toLowerCase().includes(q),
    );
  }

  if (filter !== "all") {
    arr = arr.filter((it) => {
      const st = getStatus(it, nowD);
      if (filter === "done") return it.done;
      return st === filter;
    });
  }

  const dueTime = (it) => {
    const d = parseDue(it.date, it.time);
    return d ? d.getTime() : it.createdAt || 0;
  };

  arr.sort((a, b) => {
    if (sort === "manual") return (Number(a.order || 0) - Number(b.order || 0)) || dueTime(a) - dueTime(b);
    if (sort === "dueAsc") return dueTime(a) - dueTime(b);
    if (sort === "dueDesc") return dueTime(b) - dueTime(a);
    if (sort === "priDesc") return (b.priority || 0) - (a.priority || 0) || dueTime(a) - dueTime(b);
    if (sort === "createdDesc") return (b.createdAt || 0) - (a.createdAt || 0);
    return 0;
  });

  return arr;
};

const renderList = () => {
  const list = $("#list");
  list.innerHTML = "";

  const arr = applyFilterSortSearch();
  $("#emptyHint").classList.toggle("hidden", arr.length !== 0);

  const nowD = now();
  arr.forEach((it) => {
    const st = getStatus(it, nowD);
    const due = parseDue(it.date, it.time);

    const el = document.createElement("div");
    el.dataset.itemId = it.id;
    el.className =
      "glass rounded-2xl p-4 shadow-glow ring-1 ring-white/10 hover:ring-white/20 transition flex gap-3 items-start " +
      (it.done ? "opacity-70" : "");

    el.innerHTML = `
      ${
        sort === "manual"
          ? `<button class="drag-handle" type="button" aria-label="드래그로 순서 변경" draggable="true" data-drag-id="${escapeHtml(
              it.id,
            )}">
                <span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/40 ring-1 ring-white/10 text-slate-400 hover:text-slate-200 transition">
                  <i class="bi bi-grip-vertical"></i>
                </span>
              </button>`
          : ""
      }
      <button class="check" type="button" aria-label="완료 토글">
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/40 ring-1 ring-white/10 ${
          it.done ? "text-emerald-300" : "text-slate-400"
        }">
          <i class="bi ${it.done ? "bi-check2-circle" : "bi-circle"}"></i>
        </span>
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-base font-bold tracking-tight text-slate-100 truncate" title="${escapeHtml(it.title)}">
              ${escapeHtml(it.title)}
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              ${badgePriority(it.priority)}
              ${badgeStatus(st)}
              ${
                it.parentId
                  ? `<span class="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/10 ring-1 ring-fuchsia-300/20 px-2.5 py-1 text-xs text-fuchsia-200"><i class="bi bi-arrow-repeat"></i>반복</span>`
                  : ""
              }
              ${
                it.notifyEnabled
                  ? `<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/12 ring-1 ring-amber-300/20 px-2.5 py-1 text-xs text-amber-200"><i class="bi bi-bell"></i>${Number(
                      it.notifyMins ?? 0,
                    )}분 전</span>`
                  : ""
              }
              ${
                it.category
                  ? `<span class="inline-flex items-center gap-1 rounded-full bg-slate-950/35 ring-1 ring-white/10 px-2.5 py-1 text-xs text-slate-300"><i class="bi bi-tag"></i>#${escapeHtml(
                      it.category,
                    )}</span>`
                  : ""
              }
              ${
                due
                  ? `<span class="inline-flex items-center gap-1 rounded-full bg-slate-950/35 ring-1 ring-white/10 px-2.5 py-1 text-xs text-slate-300"><i class="bi bi-calendar2-week"></i>${formatKorean(
                      due,
                    )}${it.time ? " " + escapeHtml(it.time) : ""}</span>`
                  : `<span class="inline-flex items-center gap-1 rounded-full bg-slate-950/35 ring-1 ring-white/10 px-2.5 py-1 text-xs text-slate-400"><i class="bi bi-dash-circle"></i>날짜 없음</span>`
              }
            </div>
            ${
              it.notes
                ? `<div class="mt-2 text-sm text-slate-300 truncate" title="${escapeHtml(it.notes)}">${escapeHtml(it.notes)}</div>`
                : ""
            }
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button class="edit rounded-xl px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition inline-flex items-center gap-2" type="button" aria-label="편집">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="del rounded-xl px-3 py-2 text-sm font-semibold bg-rose-500/15 hover:bg-rose-500/20 ring-1 ring-rose-300/20 transition inline-flex items-center gap-2" type="button" aria-label="삭제">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    const checkBtn = $(".check", el);
    const editBtn = $(".edit", el);
    const delBtn = $(".del", el);

    checkBtn.addEventListener("click", () => {
      it.done = !it.done;
      it.updatedAt = Date.now();
      save(items);
      renderAll();
      toast(it.done ? "완료로 표시했어요." : "미완료로 되돌렸어요.");
    });

    delBtn.addEventListener("click", () => {
      if (!confirm("이 항목을 삭제할까요?")) return;
      items = items.filter((x) => x.id !== it.id);
      save(items);
      renderAll();
      toast("삭제했어요.");
    });

    editBtn.addEventListener("click", async () => {
      await openEdit(it);
    });

    list.appendChild(el);
  });

  const base = nonTemplateItems();
  const total = base.length;
  const done = base.filter((x) => x.done).length;
  $("#countText").textContent = `전체 ${total}개 · 완료 ${done}개`;
};

const renderKpiAndCalendar = () => {
  const nowD = now();
  const base = nonTemplateItems();
  const total = base.length;
  const today = base.filter((it) => getStatus(it, nowD) === "today" && !it.done).length;
  const overdue = base.filter((it) => getStatus(it, nowD) === "overdue" && !it.done).length;

  $("#kpiTotal").textContent = total;
  $("#kpiToday").textContent = today;
  $("#kpiOverdue").textContent = overdue;

  // Next 7 days calendar (including today)
  const start = new Date(nowD);
  start.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const cal = $("#calendar");
  cal.innerHTML = "";

  days.forEach((d) => {
    const key = toDateKey(d);
    const dayItems = nonTemplateItems()
      .filter((it) => it.date === key)
      .sort((a, b) => {
        const ta = a.time ? a.time : "23:59";
        const tb = b.time ? b.time : "23:59";
        if (ta !== tb) return ta.localeCompare(tb);
        return (b.priority || 0) - (a.priority || 0);
      });

    const box = document.createElement("div");
    box.className = "rounded-2xl bg-slate-950/35 ring-1 ring-white/10 overflow-hidden";
    box.innerHTML = `
      <div class="px-4 py-3 flex items-center justify-between bg-white/5">
        <div class="text-sm font-semibold text-slate-100">${formatKorean(d)}</div>
        <div class="text-xs text-slate-400">${dayItems.length}개</div>
      </div>
      <div class="p-3 space-y-2 dlist"></div>
    `;
    const dlist = $(".dlist", box);

    if (!dayItems.length) {
      const empty = document.createElement("div");
      empty.className = "text-sm text-slate-400";
      empty.textContent = "등록된 일정이 없어요.";
      dlist.appendChild(empty);
    } else {
      dayItems.forEach((it) => {
        const mini = document.createElement("div");
        mini.className = "rounded-2xl bg-black/20 ring-1 ring-white/10 p-3 flex items-start justify-between gap-3";
        mini.innerHTML = `
          <div class="min-w-0">
            <div class="text-sm font-semibold text-slate-100 truncate" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
            <div class="mt-1 text-xs text-slate-400">
              <i class="bi bi-clock"></i>
              ${it.time ? escapeHtml(it.time) : "시간 없음"} · ${priorityLabel(it.priority)}${it.done ? " · 완료" : ""}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button class="mini-done rounded-xl px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition" type="button" aria-label="완료 토글" title="완료 토글">
              <i class="bi ${it.done ? "bi-arrow-counterclockwise" : "bi-check2"}"></i>
            </button>
            <button class="mini-edit rounded-xl px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition" type="button" aria-label="편집" title="편집">
              <i class="bi bi-pencil"></i>
            </button>
          </div>
        `;
        const btnDone = $(".mini-done", mini);
        const btnEdit = $(".mini-edit", mini);

        btnDone.addEventListener("click", () => {
          it.done = !it.done;
          it.updatedAt = Date.now();
          save(items);
          renderAll();
        });
        btnEdit.addEventListener("click", async () => {
          await openEdit(it);
        });

        dlist.appendChild(mini);
      });
    }

    cal.appendChild(box);
  });
};

const renderAll = () => {
  renderTop();
  renderList();
  renderKpiAndCalendar();
  renderRecurringList();
};

// --- UI Helpers ---
const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const priorityLabel = (p) => (p == 2 ? "높음" : p == 1 ? "보통" : "낮음");
const badgePriority = (p) => {
  if (p == 2)
    return `<span class="inline-flex items-center gap-1 rounded-full bg-rose-500/15 ring-1 ring-rose-300/20 px-2.5 py-1 text-xs text-rose-200"><i class="bi bi-flag-fill"></i>높음</span>`;
  if (p == 1)
    return `<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 ring-1 ring-amber-300/20 px-2.5 py-1 text-xs text-amber-200"><i class="bi bi-flag"></i>보통</span>`;
  return `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 ring-1 ring-emerald-300/20 px-2.5 py-1 text-xs text-emerald-200"><i class="bi bi-flag"></i>낮음</span>`;
};
const badgeStatus = (st) => {
  if (st === "today")
    return `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 ring-1 ring-indigo-300/20 px-2.5 py-1 text-xs text-indigo-200"><i class="bi bi-stars"></i>오늘</span>`;
  if (st === "upcoming")
    return `<span class="inline-flex items-center gap-1 rounded-full bg-sky-500/12 ring-1 ring-sky-300/20 px-2.5 py-1 text-xs text-sky-200"><i class="bi bi-arrow-right"></i>예정</span>`;
  if (st === "overdue")
    return `<span class="inline-flex items-center gap-1 rounded-full bg-rose-500/15 ring-1 ring-rose-300/20 px-2.5 py-1 text-xs text-rose-200"><i class="bi bi-exclamation-triangle"></i>지연</span>`;
  if (st === "plain")
    return `<span class="inline-flex items-center gap-1 rounded-full bg-slate-500/10 ring-1 ring-white/10 px-2.5 py-1 text-xs text-slate-300"><i class="bi bi-dot"></i>일반</span>`;
  return `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 ring-1 ring-emerald-300/20 px-2.5 py-1 text-xs text-emerald-200"><i class="bi bi-check2-circle"></i>완료</span>`;
};

// --- CRUD ---
const addItem = (data) => {
  const it = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    title: data.title.trim(),
    date: data.date || "",
    time: data.time || "",
    priority: Number(data.priority ?? 1),
    category: (data.category || "").trim(),
    notes: (data.notes || "").trim(),
    repeat: clampRepeat(data.repeat ?? "none"),
    template: Boolean(data.template ?? false),
    instance: Boolean(data.instance ?? false),
    parentId: data.parentId || "",
    notifyEnabled: Boolean(data.notifyEnabled ?? false),
    notifyMins: Number(data.notifyMins ?? 5),
    notified: false,
    googleTaskId: String(data.googleTaskId || ""),
    order: getMaxOrder() + 1,
    done: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  items.push(it);
  save(items);
  return it;
};

let editingItem = null;
let editModalInst = null;
const openEdit = async (it) => {
  const bs = window.bootstrap;
  const modalEl = $("#editModal");
  if (!bs?.Modal || !modalEl) {
    // fallback: Bootstrap을 못 불러온 경우 기존 prompt 방식
    const title = prompt("할 일(제목)을 수정하세요:", it.title);
    if (title === null) return;
    const date = prompt("날짜(YYYY-MM-DD) / 비우면 없음:", it.date || "");
    if (date === null) return;
    const time = prompt("시간(HH:MM) / 비우면 없음:", it.time || "");
    if (time === null) return;
    const category = prompt("카테고리:", it.category || "");
    if (category === null) return;
    const notes = prompt("메모:", it.notes || "");
    if (notes === null) return;
    const pr = prompt("우선순위(0=낮음, 1=보통, 2=높음):", String(it.priority ?? 1));
    if (pr === null) return;

    it.title = title.trim() || it.title;
    it.date = (date || "").trim();
    it.time = (time || "").trim();
    it.category = (category || "").trim();
    it.notes = (notes || "").trim();
    it.priority = [0, 1, 2].includes(Number(pr)) ? Number(pr) : it.priority ?? 1;
    it.updatedAt = Date.now();

    save(items);
    renderAll();
    toast("수정했어요.");
    return;
  }

  editingItem = it;
  $("#editTitle").value = it.title || "";
  $("#editDate").value = it.date || "";
  $("#editTime").value = it.time || "";
  $("#editPriority").value = String(it.priority ?? 1);
  $("#editCategory").value = it.category || "";
  $("#editNotes").value = it.notes || "";
  $("#editDone").checked = Boolean(it.done);
  $("#editRepeat").value = clampRepeat(it.repeat ?? "none");
  $("#editNotifyEnabled").checked = Boolean(it.notifyEnabled);
  $("#editNotifyMins").value = String(Number(it.notifyMins ?? 5));

  // 인스턴스는 반복 변경 불가(템플릿에서만)
  $("#editRepeat").disabled = Boolean(it.parentId);

  editModalInst = editModalInst ?? bs.Modal.getOrCreateInstance(modalEl);
  editModalInst.show();
};

// --- Wire events ---
$("#todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    title: $("#title").value,
    date: $("#date").value,
    time: $("#time").value,
    priority: $("#priority").value,
    category: $("#category").value,
    notes: $("#notes").value,
    repeat: $("#repeat")?.value ?? "none",
    notifyEnabled: $("#notifyEnabled")?.checked ?? false,
    notifyMins: Number($("#notifyMins")?.value ?? 5),
  };
  if (!data.title.trim()) return;

  const repeat = clampRepeat(data.repeat);
  if (repeat !== "none") {
    if (!data.date) {
      toast("반복 일정은 날짜(시작일)가 필요해요.");
      return;
    }
    const tpl = addItem({
      ...data,
      template: true,
      instance: false,
      repeat,
    });
    syncRecurring();
    toast("반복 일정을 추가했어요.");
  } else {
    addItem({
      ...data,
      template: false,
      instance: false,
      repeat: "none",
    });
    toast("추가했어요.");
  }

  // UX: 제목만 비우고 나머지는 유지(연속 입력)
  $("#title").value = "";
  $("#title").focus();

  save(items);
  renderAll();
});

$("#clearFormBtn").addEventListener("click", () => {
  $("#title").value = "";
  $("#date").value = "";
  $("#time").value = "";
  $("#priority").value = "1";
  $("#category").value = "";
  $("#notes").value = "";
  if ($("#repeat")) $("#repeat").value = "none";
  if ($("#notifyEnabled")) $("#notifyEnabled").checked = false;
  if ($("#notifyMins")) $("#notifyMins").value = "5";
  $("#title").focus();
});

const syncFilterUI = () => {
  $$(".filter-btn").forEach((btn) => {
    // base
    btn.classList.add("transition", "text-slate-300", "hover:bg-white/5", "hover:text-white");

    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle("bg-white/10", isActive);
    btn.classList.toggle("text-white", isActive);
    btn.classList.toggle("ring-1", isActive);
    btn.classList.toggle("ring-white/10", isActive);
  });
};

$$(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    syncFilterUI();
    renderList();
  });
});

$("#search").addEventListener("input", (e) => {
  search = e.target.value || "";
  renderList();
});

$("#sort").addEventListener("change", (e) => {
  sort = e.target.value;
  renderList();
});

$("#notifPermBtn")?.addEventListener("click", async () => {
  await requestNotifPermission();
});

// Google Tasks modal events
$("#gTasksBtn")?.addEventListener("click", async () => {
  const bs = window.bootstrap;
  const modalEl = $("#gTasksModal");
  if (!bs?.Modal || !modalEl) return;

  // load cfg to UI
  const cfg = loadGoogleCfg();
  gCfg.clientId = cfg.clientId;
  gCfg.tasklistId = cfg.tasklistId;
  $("#gClientId").value = gCfg.clientId;
  $("#gTasklist").value = gCfg.tasklistId;

  setGStatus(isGTokenValid() ? "연결됨" : "연결 안 됨");

  const inst = bs.Modal.getOrCreateInstance(modalEl);
  inst.show();
});

$("#gSaveCfgBtn")?.addEventListener("click", () => {
  gCfg.clientId = String($("#gClientId")?.value || "").trim();
  gCfg.tasklistId = String($("#gTasklist")?.value || "").trim();
  saveGoogleCfg(gCfg);
  toast("Google 설정을 저장했어요.");
});

$("#gTasklist")?.addEventListener("change", (e) => {
  gCfg.tasklistId = String(e.target.value || "");
  saveGoogleCfg(gCfg);
});

$("#gConnectBtn")?.addEventListener("click", async () => {
  try {
    gCfg.clientId = String($("#gClientId")?.value || "").trim();
    saveGoogleCfg(gCfg);
    setGStatus("연결 중…");
    await getAccessToken({ interactive: true });
    await gRefreshTasklistsUI();
    setGStatus("연결됨");
  } catch (e) {
    setGStatus("연결 실패");
    toast(`연결 실패: ${e?.message || String(e)}`);
  }
});

$("#gDisconnectBtn")?.addEventListener("click", () => {
  clearGoogleToken();
  gToken = null;
  setGStatus("연결 해제됨");
  toast("Google 연결을 해제했어요.");
});

$("#gImportBtn")?.addEventListener("click", async () => {
  try {
    await gImport();
  } catch (e) {
    toast(`가져오기 실패: ${e?.message || String(e)}`);
  }
});

$("#gExportBtn")?.addEventListener("click", async () => {
  try {
    await gExport();
  } catch (e) {
    toast(`내보내기 실패: ${e?.message || String(e)}`);
  }
});

$("#gSyncBtn")?.addEventListener("click", async () => {
  try {
    await gSync();
  } catch (e) {
    toast(`동기화 실패: ${e?.message || String(e)}`);
  }
});

$("#markTodayBtn").addEventListener("click", () => {
  $("#date").value = toDateKey(new Date());
  $("#title").focus();
  toast("날짜를 오늘로 설정했어요.");
});

$("#resetBtn").addEventListener("click", () => {
  if (!confirm("정말로 전체 데이터를 초기화할까요? (되돌릴 수 없음)")) return;
  items = [];
  save(items);
  renderAll();
  toast("초기화했어요.");
});

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `todo-backup-${toDateKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("내보내기 완료!");
});

$("#importInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("형식이 올바르지 않습니다.");
    // 최소 검증
    const cleaned = arr.map((x) => {
      const repeat = clampRepeat(x.repeat ?? "none");
      const template = Boolean(x.template ?? (repeat !== "none"));
      return {
        id: x.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
        title: String(x.title || "").trim() || "제목 없음",
        date: String(x.date || ""),
        time: String(x.time || ""),
        priority: [0, 1, 2].includes(Number(x.priority)) ? Number(x.priority) : 1,
        category: String(x.category || ""),
        notes: String(x.notes || ""),
        repeat,
        template,
        instance: Boolean(x.instance ?? false),
        parentId: String(x.parentId || ""),
        notifyEnabled: Boolean(x.notifyEnabled ?? false),
        notifyMins: Number(x.notifyMins ?? 5),
        notified: Boolean(x.notified ?? false),
        order: Number(x.order ?? 0),
        done: Boolean(x.done),
        createdAt: Number(x.createdAt || Date.now()),
        updatedAt: Number(x.updatedAt || Date.now()),
      };
    });
    items = cleaned;
    save(items);
    syncRecurring();
    renderAll();
    toast("가져오기 완료!");
  } catch (err) {
    alert("가져오기에 실패했어요: " + (err?.message || String(err)));
  } finally {
    e.target.value = "";
  }
});

// --- Edit Modal events ---
$("#editSaveBtn")?.addEventListener("click", () => {
  if (!editingItem) return;
  const wasTemplate = isTemplate(editingItem);

  const title = $("#editTitle").value.trim();
  if (!title) {
    toast("할 일을 입력해 주세요.");
    return;
  }

  editingItem.title = title;
  editingItem.date = ($("#editDate").value || "").trim();
  editingItem.time = ($("#editTime").value || "").trim();
  editingItem.category = ($("#editCategory").value || "").trim();
  editingItem.notes = ($("#editNotes").value || "").trim();
  editingItem.priority = Number($("#editPriority").value ?? 1);
  editingItem.done = Boolean($("#editDone").checked);
  editingItem.notifyEnabled = Boolean($("#editNotifyEnabled").checked);
  editingItem.notifyMins = Number($("#editNotifyMins").value ?? 5);
  editingItem.notified = false;

  if (!editingItem.parentId) {
    const nextRepeat = clampRepeat($("#editRepeat").value ?? "none");
    editingItem.repeat = nextRepeat;
    editingItem.template = nextRepeat !== "none";

    // 반복을 끄면(템플릿 해제) 기존 인스턴스도 정리
    if (wasTemplate && nextRepeat === "none") {
      items = items.filter((x) => x.parentId !== editingItem.id);
    }
  }
  editingItem.updatedAt = Date.now();

  save(items);
  syncRecurring();
  renderAll();
  toast("저장했어요.");

  // 모달 닫기
  const bs = window.bootstrap;
  const modalEl = $("#editModal");
  if (bs?.Modal && modalEl) {
    const inst = bs.Modal.getInstance(modalEl);
    inst?.hide();
  }
});

$("#editForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  $("#editSaveBtn")?.click();
});

// --- Recurring (template -> instances) ---
const stepDate = (d, repeat) => {
  const nd = new Date(d);
  if (repeat === "daily") nd.setDate(nd.getDate() + 1);
  else if (repeat === "weekly") nd.setDate(nd.getDate() + 7);
  else if (repeat === "monthly") nd.setMonth(nd.getMonth() + 1);
  return nd;
};

const syncRecurring = () => {
  const nowD = now();
  const start = new Date(nowD);
  start.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(start);
  const horizon = new Date(start);
  horizon.setDate(horizon.getDate() + 30);

  const templates = items.filter((it) => isTemplate(it) && clampRepeat(it.repeat) !== "none");

  templates.forEach((tpl) => {
    const repeat = clampRepeat(tpl.repeat);
    if (!tpl.date) return;

    // 템플릿 변경이 인스턴스에 반영되도록: 오늘 이후 인스턴스는 재생성
    items = items.filter((it) => !(it.parentId === tpl.id && String(it.date || "") >= todayKey));

    const existing = new Set(
      items
        .filter((it) => it.parentId === tpl.id)
        .map((it) => `${it.parentId}|${it.date}|${it.time || ""}`),
    );

    let d = parseDue(tpl.date, tpl.time) || new Date(`${tpl.date}T00:00:00`);
    // 시작일이 오늘보다 과거면 today 기준으로 앞으로만 생성
    while (d.getTime() < start.getTime()) d = stepDate(d, repeat);

    while (d.getTime() <= horizon.getTime()) {
      const key = toDateKey(d);
      const instKey = `${tpl.id}|${key}|${tpl.time || ""}`;
      if (!existing.has(instKey)) {
        items.push({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
          title: tpl.title,
          date: key,
          time: tpl.time || "",
          priority: Number(tpl.priority ?? 1),
          category: tpl.category || "",
          notes: tpl.notes || "",
          repeat: "none",
          template: false,
          instance: true,
          parentId: tpl.id,
          notifyEnabled: Boolean(tpl.notifyEnabled),
          notifyMins: Number(tpl.notifyMins ?? 5),
          notified: false,
          order: getMaxOrder() + 1,
          done: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        existing.add(instKey);
      }
      d = stepDate(d, repeat);
    }
  });

  save(items);
};

// --- Recurring templates UI ---
const renderRecurringList = () => {
  const box = $("#recurringList");
  const empty = $("#recurringEmpty");
  if (!box || !empty) return;

  const tpls = items
    .filter((it) => isTemplate(it) && clampRepeat(it.repeat) !== "none")
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  box.innerHTML = "";
  empty.classList.toggle("hidden", tpls.length !== 0);

  const repeatLabel = (r) => (r === "daily" ? "매일" : r === "weekly" ? "매주" : r === "monthly" ? "매월" : "없음");

  tpls.forEach((tpl) => {
    const el = document.createElement("div");
    el.className = "rounded-2xl bg-slate-950/35 ring-1 ring-white/10 p-3 flex items-start justify-between gap-3";
    el.innerHTML = `
      <div class="min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate" title="${escapeHtml(tpl.title)}">${escapeHtml(tpl.title)}</div>
        <div class="mt-1 text-xs text-slate-400 flex flex-wrap gap-2 items-center">
          <span class="inline-flex items-center gap-1"><i class="bi bi-arrow-repeat"></i>${repeatLabel(clampRepeat(tpl.repeat))}</span>
          <span class="inline-flex items-center gap-1"><i class="bi bi-calendar2-week"></i>${escapeHtml(tpl.date || "")}${tpl.time ? " " + escapeHtml(tpl.time) : ""}</span>
          ${
            tpl.notifyEnabled
              ? `<span class="inline-flex items-center gap-1"><i class="bi bi-bell"></i>${Number(tpl.notifyMins ?? 5)}분 전</span>`
              : ""
          }
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button class="tpl-edit rounded-xl px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition inline-flex items-center gap-2" type="button">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="tpl-del rounded-xl px-3 py-2 text-sm font-semibold bg-rose-500/15 hover:bg-rose-500/20 ring-1 ring-rose-300/20 transition inline-flex items-center gap-2" type="button">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    `;

    $(".tpl-edit", el).addEventListener("click", async () => {
      await openEdit(tpl);
    });
    $(".tpl-del", el).addEventListener("click", () => {
      if (!confirm("이 반복 일정을 삭제할까요? (생성된 일정도 함께 삭제)")) return;
      items = items.filter((x) => x.id !== tpl.id && x.parentId !== tpl.id);
      save(items);
      renderAll();
      toast("삭제했어요.");
    });

    box.appendChild(el);
  });
};

// --- Drag reorder (manual sort) ---
let draggingId = null;
let dragOverId = null;
$("#list")?.addEventListener("dragstart", (e) => {
  const handle = e.target?.closest?.("[data-drag-id]");
  if (!handle) return;
  if (sort !== "manual") {
    e.preventDefault();
    toast("드래그 정렬은 정렬을 “수동 정렬(드래그)”로 바꾸면 사용할 수 있어요.");
    return;
  }
  draggingId = handle.getAttribute("data-drag-id");
  e.dataTransfer?.setData("text/plain", draggingId);
  e.dataTransfer?.setDragImage(handle, 10, 10);
});

$("#list")?.addEventListener("dragover", (e) => {
  if (sort !== "manual" || !draggingId) return;
  e.preventDefault();
  const itemEl = e.target?.closest?.("[data-item-id]");
  if (!itemEl) return;
  dragOverId = itemEl.dataset.itemId;
});

$("#list")?.addEventListener("drop", (e) => {
  if (sort !== "manual" || !draggingId) return;
  e.preventDefault();
  const targetEl = e.target?.closest?.("[data-item-id]");
  if (!targetEl) return;
  const targetId = targetEl.dataset.itemId;
  if (!targetId || targetId === draggingId) return;

  const visible = applyFilterSortSearch().map((x) => x.id);
  const fromIdx = visible.indexOf(draggingId);
  const toIdx = visible.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;

  visible.splice(fromIdx, 1);
  visible.splice(toIdx, 0, draggingId);

  // 업데이트: non-template만 수동 order 부여
  const map = new Map(visible.map((id, i) => [id, i + 1]));
  items.forEach((it) => {
    if (isTemplate(it)) return;
    if (!map.has(it.id)) return;
    it.order = map.get(it.id);
    it.updatedAt = Date.now();
  });

  save(items);
  renderAll();
  toast("순서를 변경했어요.");
});

$("#list")?.addEventListener("dragend", () => {
  draggingId = null;
  dragOverId = null;
});

// --- Notification scheduler ---
const tickNotifications = () => {
  if (!canUseNotifications() || Notification.permission !== "granted") return;
  const nowMs = Date.now();
  let changed = false;

  nonTemplateItems().forEach((it) => {
    if (it.done) return;
    if (!it.notifyEnabled) return;
    const due = parseDue(it.date, it.time);
    if (!due) return;

    const mins = Number(it.notifyMins ?? 0);
    const notifyAt = due.getTime() - mins * 60_000;

    // 20초 윈도우 내 1회만 발송
    if (!it.notified && nowMs >= notifyAt && nowMs - notifyAt <= 20_000) {
      const ok = fireNotification(it.title, `${formatKorean(due)} ${it.time || ""}`.trim(), it.id);
      if (ok) {
        it.notified = true;
        changed = true;
      }
    }
  });

  if (changed) save(items);
};

// --- Initial boot (모든 함수 정의 이후 실행) ---
const initApp = () => {
  syncFilterUI();
  syncRecurring();
  renderAll();

  setInterval(renderTop, 1000 * 15);
  setInterval(tickNotifications, 10_000);
  tickNotifications();
};

initApp();
