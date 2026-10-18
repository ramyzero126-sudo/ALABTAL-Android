(() => {
  const $ = s => document.querySelector(s);
  const list = $("#riders");
  let data = [];
  let status = "الكل";
  let selectedCity = "الكل";
  let busy = false;

  const text = (obj, keys, fallback = "") => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return fallback;
  };

  const number = (obj, keys, fallback = 0) => {
    const v = Number(text(obj, keys, fallback));
    return Number.isFinite(v) ? v : fallback;
  };


  function orderField(order, pattern) {
    const seen = new Set();
    function walk(value, depth) {
      if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return "";
      seen.add(value);
      for (const [key, val] of Object.entries(value)) {
        if (pattern.test(key) && val != null && typeof val !== "object" && String(val).trim()) {
          return String(val);
        }
      }
      for (const val of Object.values(value)) {
        const found = walk(val, depth + 1);
        if (found) return found;
      }
      return "";
    }
    return walk(order, 0) || "—";
  }

  function normalize(x) {
    const name = text(x, ["name","riderName","rider_name","fullName","full_name","employeeName","driverName"], "مندوب");
    const id = text(x, ["id","empId","riderId","rider_id","employeeId","employee_id","code"], "—");
    const rawStatus = String(text(x, ["status","riderStatus","rider_status","state","workingStatus"], "غير محدد"));
    const s = rawStatus.trim().toLowerCase();
    let state = rawStatus.trim() || "غير محدد";

    // Normalize source values so the rider card, tab counts and filters agree.
    if (/break|rest|استراحة|بريك/.test(s)) state = "Break";
    else if (/temp|temporary|tamp|tam|مؤقت/.test(s)) state = "Tamp";
    else if (/starting|start|بدء|بداية/.test(s)) state = "Starting";
    else if (/ready|available|جاهز/.test(s)) state = "Ready";
    else if (/working|work|active|online|شغال|يعمل/.test(s)) state = "Working";
    else if (/late|delay|متأخر/.test(s)) state = "متأخر";

    const orders = number(x, ["orders","ordersCount","orders_count","totalOrders","todayOrders","completedOrders"]);
    const hours = text(x, ["hours","workingHours","working_hours","totalHours","shiftHours"], "—");
    const utr = text(x, ["utr","UTR","utrValue"], "—");
    const breaks = number(x, ["breaks","breakCount","break_count","breaksCount"]);
    const progress = Math.max(0, Math.min(100, number(x, ["progress","progressPercent","progress_percent"], 0)));

    return {
      raw: x, name: String(name), id: String(id),
      city: String(text(x, ["city","cityName","city_name","zone","location"], "—")),
      status: state, orders, hours: String(hours), utr: String(utr),
      breaks, progress, wallet: String(text(x, ["wallet","balance","walletBalance"], "—")), shiftStart: String(text(x, ["shiftStart"], "—")), shiftEnd: String(text(x, ["shiftEnd","shiftEndOrig"], "—")),
      supervisor: String(text(x, ["supervisor","supervisorName","supervisor_name","manager"], "—")),
      bookedTomorrow: x.bookedTomorrow === true || String(x.bookedTomorrow).toLowerCase() === "true",
      activeOrder: Array.isArray(x.activeOrders) ? x.activeOrders.find(o => o && typeof o === "object") : (x.activeOrders && typeof x.activeOrders === "object" ? x.activeOrders : null)
    };
  }


  let notificationBaseline = null;

  try {
    window.alabtalNotifications = JSON.parse(
      localStorage.getItem("alabtal_notifications") || "[]"
    );
    if (!Array.isArray(window.alabtalNotifications))
      window.alabtalNotifications = [];
  } catch (_) {
    window.alabtalNotifications = [];
  }

  function saveAlabtalNotifications() {
    try {
      localStorage.setItem(
        "alabtal_notifications",
        JSON.stringify((window.alabtalNotifications || []).slice(0, 30))
      );
    } catch (_) {}
  }

  function notifyRiderStatusChanges(rows) {
    const current = new Map();

    for (const rider of rows) {
      const key = rider.id && rider.id !== "—"
        ? "id:" + rider.id
        : "name:" + rider.name;
      current.set(key, rider);
    }

    if (notificationBaseline === null) {
      notificationBaseline = current;
      return;
    }

    for (const [key, rider] of current) {
      const old = notificationBaseline.get(key);
      if (!old || old.status === rider.status) continue;

      const item = {
        id: key + ":" + Date.now(),
        text: `${rider.name}: ${old.status} → ${rider.status}`,
        time: new Date().toLocaleTimeString("ar-EG", {
          hour: "2-digit", minute: "2-digit"
        })
      };
      window.alabtalNotifications.unshift(item);
      window.alabtalNotifications = window.alabtalNotifications.slice(0, 30);
      saveAlabtalNotifications();
      window.dispatchEvent(new CustomEvent("alabtal-notifications-updated"));

      try {
        if (window.AndroidNotifications &&
            typeof window.AndroidNotifications.show === "function") {
          window.AndroidNotifications.show(
            "تغيّرت حالة مندوب - ALABTAL", item.text
          );
        }
      } catch (error) {
        console.error("[ALABTAL notifications]", error);
      }
    }

    notificationBaseline = current;
  }

  function showLogin(message = "") {
    let box = $("#alabtalLogin");
    if (!box) {
      box = document.createElement("div");
      box.id = "alabtalLogin";
      box.style.cssText = "position:fixed;inset:0;z-index:9999;background:#090909f5;display:grid;place-items:center;padding:20px";
      box.innerHTML = `
        <form id="alabtalLoginForm" style="width:min(100%,390px);background:#171717;border:1px solid #ff7900;border-radius:18px;padding:24px;color:#fff;font-family:inherit">
          <h2 style="color:#ff7900;margin:0 0 8px">ALABTAL LIVE</h2>
          <p style="color:#bbb">سجّل دخولك بحساب لوحة Desktop</p>
          <label style="display:block;margin:16px 0 6px">اسم المستخدم</label>
          <input name="username" autocomplete="username" required style="box-sizing:border-box;width:100%;padding:13px;border-radius:9px;border:1px solid #444;background:#222;color:white">
          <label style="display:block;margin:14px 0 6px">كلمة المرور</label>
          <input name="password" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:13px;border-radius:9px;border:1px solid #444;background:#222;color:white">
          <p id="alabtalLoginError" style="color:#ff8b72;font-size:13px"></p>
          <button id="alabtalLoginBtn" style="width:100%;padding:13px;border:0;border-radius:9px;background:#ff7900;color:#111;font-weight:bold">تسجيل الدخول</button>
        </form>`;
      document.body.appendChild(box);
      $("#alabtalLoginForm").addEventListener("submit", async e => {
        e.preventDefault();
        const btn = $("#alabtalLoginBtn");
        const err = $("#alabtalLoginError");
        btn.disabled = true;
        btn.textContent = "جارٍ تسجيل الدخول...";
        err.textContent = "";
        try {
          const fd = new FormData(e.target);
          const res = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              username: fd.get("username"),
              password: fd.get("password")
            })
          });
          const result = await res.json();
          if (!res.ok || !result.ok) throw new Error(result.error || "فشل تسجيل الدخول");
          box.remove();
          await loadData();
        } catch (error) {
          err.textContent = error.message || "تعذر الاتصال بالبروكسي";
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = "تسجيل الدخول";
          }
        }
      });
    }
    if (message) $("#alabtalLoginError").textContent = message;
  }


  let liveSummaryStats = null;

  function updateDashboardStats() {
    const total = key => data.reduce((n, r) => {
      const v = String(r[key] ?? "").replace(",", ".");
      const m = v.match(/-?\d+(?:\.\d+)?/);
      return n + (m ? Number(m[0]) : 0);
    }, 0);
    const available = key => data.filter(r =>
      r.raw && r.raw[key] !== undefined &&
      r.raw[key] !== null && String(r.raw[key]).trim() !== ""
    );
    const src = liveSummaryStats || {};
    const num = (key, fallback) =>
      typeof src[key] === "number" && Number.isFinite(src[key])
        ? src[key] : fallback;
    const fmt = (n, digits = 1) =>
      Number(n).toLocaleString("ar-EG", { maximumFractionDigits: digits });

    const orders = num("orders", total("orders"));
    const hours = num("hours",
      available("hours").length ? total("hours") : NaN);
    const lateMinutes = num("lateMinutes",
      available("lateMinutes").length ? total("lateMinutes") : NaN);
    const stats = {
      "إجمالي المناديب": String(num("open", data.length)),
      "إجمالي الأوردرات": fmt(orders, 0),
      "الأوردرات": fmt(orders, 0),
      "ساعات العمل": Number.isFinite(hours) ? fmt(hours) : "غير متاح",
      "متأخر (ساعة)": Number.isFinite(lateMinutes)
        ? fmt(lateMinutes / 60) : "غير متاح",
      "UTR": Number.isFinite(hours) && hours > 0
        ? fmt(orders / hours) : "غير متاح",
      "خارج التغطية": "غير متاح",
      "بريك": fmt(total("breaks"), 0),
      "مخالفات اليوم": "غير متاح",
      "أمراء المناوبات": "غير متاح",
      "مناديب تحت المتابعة": "غير متاح"
    };

    document.querySelectorAll(".tile").forEach(tile => {
      const label = tile.querySelector("label");
      const value = tile.querySelector("strong");
      if (!label || !value) return;
      const key = label.textContent.trim();
      if (Object.prototype.hasOwnProperty.call(stats, key)) {
        value.textContent = stats[key];
      }
    });
  }

  function render() {
    if (!list) return;

    const cityTabs = $("#cityTabs");
    const cities = []; // إخفاء تبويب المدينة الثابت

    if (selectedCity !== "الكل" && !cities.includes(selectedCity)) selectedCity = "الكل";

    if (cityTabs) {
      cityTabs.innerHTML = [
        ...cities.map(city => {
          const count = data.filter(r => ((r.city || "").trim() || "غير محددة") === city).length;
          return `<button type="button" class="chip ${selectedCity === city ? "active" : ""}" data-city="${esc(city)}">${esc(city)} <b>${count}</b></button>`;
        })
      ].join("");
    }

    // Real status counts from the current rider data
    document.querySelectorAll("#filters [data-status]").forEach(button => {
      const key = button.dataset.status || "الكل";
      if (!button.dataset.baseLabel) {
        button.dataset.baseLabel = button.textContent.trim();
      }
      const count = key === "الكل"
        ? data.length
        : data.filter(r => r.status === key).length;
      button.innerHTML = `${esc(button.dataset.baseLabel)} <b>${count}</b>`;
    });

    const rows = data.filter(r => {
      const statusMatch = status === "الكل" || r.status === status;
      const city = (r.city || "").trim() || "غير محددة";
      const cityMatch = selectedCity === "الكل" || city === selectedCity;
      return statusMatch && cityMatch;
    });

    rows.sort((a,b) => a.name.localeCompare(b.name, "ar"));

  window.formatShiftTime = function(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "—" || raw === "-") return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(d);
  }


    const card = r => {
      const order = r.activeOrder;
      const restaurant = order ? orderField(order, /vendor|restaurant|merchant|shop|store|name/i) : "";
      const pickup = order ? orderField(order, /pickup|pick.?up|collect|restaurantAddress|fromAddress/i) : "";
      const dropoff = order ? orderField(order, /drop.?off|deliveryAddress|customerAddress|destination|deliverTo/i) : "";
      const orderStatus = order ? orderField(order, /orderStatus|status|state|currentStatus/i) : "";
      const orderId = order ? orderField(order, /orderId|order_id|id|code/i) : "";
      const orderStep = !order ? 0 :
        /delivered|completed|complete|تم التوصيل|تم التسليم|وصل للعميل/i.test(orderStatus) ? 4 :
        /deliver|on.?way|في الطريق|heading|to.?customer/i.test(orderStatus) ? 3 :
        /picked|pickup|collected|استلام|تم الاستلام/i.test(orderStatus) ? 2 :
        /arrive|arrived|at.?customer|وصل عند العميل/i.test(orderStatus) ? 4 : 1;
      const riderPhone = riderActionPhone(r.raw);
      const phoneDigits = riderPhone.replace(/\D/g, "");
      const internationalPhone = phoneDigits.startsWith("00") ? phoneDigits.slice(2) :
        phoneDigits.startsWith("0") ? "20" + phoneDigits.slice(1) :
        phoneDigits.length === 10 && phoneDigits.startsWith("1") ? "20" + phoneDigits : phoneDigits;

      let statusLabel = "مفيش أوردر";
      let statusClass = "no-order";
      if (order) {
        statusClass = "has-order";
        const s = (orderStatus || "").toLowerCase();
        if (/picked|pickup|collected|استلام|تم الاستلام/.test(s)) statusLabel = "تم الاستلام من المطعم";
        else if (/deliver|on.?way|في الطريق|heading|to.?customer/.test(s)) statusLabel = "في الطريق للعميل";
        else if (/arrive|arrived|وصل|at.?customer|delivered/.test(s)) statusLabel = "وصل عند العميل";
        else if (/ready|preparing|جاري|cooking|at.?restaurant|وصل عند المطعم/.test(s)) statusLabel = "وصل عند المطعم";
        else if (/assign|new|pending|معاه/.test(s)) statusLabel = "معاه أوردر";
        else statusLabel = orderStatus || "معاه أوردر";
      }

      return `
      <article class="rider" data-rider-name="${esc(r.name)}" data-rider-id="${esc(r.id)}">
        <div class="rider-led-strip" aria-hidden="true"></div>
        <div class="rider-head">
          <div class="avatar">🛵</div>
          <div class="rider-info">
            <div class="rider-name-row">
              <div class="rider-name">${esc(r.name)}</div>
              <span class="status status-${String(r.status).toLowerCase().replace(/[^a-z0-9]+/g,"-")}">${esc(r.status)}</span>
            </div>
            <div class="rider-status-line">
              <span class="order-status-badge ${statusClass}"><i class="order-led"></i>${order ? esc(statusLabel) : "مفيش أوردر"}</span>
            </div>
            <div class="sub">#${esc(r.id)} · 📍 ${esc(r.city)}</div>

            <div class="sub">♙ ${esc(r.supervisor)}</div>
            <div class="sub">🕒 ${esc(formatShiftTime(r.shiftStart))} → ${esc(formatShiftTime(r.shiftEnd))}</div>
          </div>
        </div>

        ${order ? `<div class="order-progress" aria-label="تقدم الأوردر">
          <div class="order-progress-title"><b>🚚 رحلة الأوردر</b><span>#${esc(orderId)}</span></div>
          <div class="order-progress-track"><span class="order-progress-fill step-${orderStep}"></span><span class="order-lane-led" aria-hidden="true"></span><span class="order-scooter">🛵</span></div>
          <div class="order-progress-labels"><span class="${orderStep>=1?'done':''}">المطعم</span><span class="${orderStep>=2?'done':''}">استلام</span><span class="${orderStep>=3?'done':''}">في الطريق</span><span class="${orderStep>=4?'done':''}">العميل</span></div>
          <div class="order-progress-current">${esc(statusLabel)}</div>
        </div>` : ""}
      <div class="metrics">
          <div class="metric"><b>${r.orders}</b><small>أوردر</small></div>
          <div class="metric"><b>${esc(r.utr)}</b><small>UTR</small></div>
          <div class="metric"><b>${esc(r.hours)}</b><small>ساعة</small></div>
          <div class="metric"><b>${r.breaks}</b><small>بريك</small></div>
        </div>

        <div class="wallet-row">
          <span>💰 المحفظة</span>
          <b>${esc(r.wallet)}</b>
        </div>

        <div class="actions">
          <button type="button" class="action" data-rider-action="whatsapp">واتساب</button>
          <button type="button" class="action" data-rider-action="call">اتصال</button>
          <button type="button" class="action" data-rider-action="lock">قفل</button>
          <button type="button" class="action" data-rider-action="break">فك بريك</button>
          <button type="button" class="action" data-rider-action="supply">تزويد</button>
        </div>
      </article>`;
    };

    if (!rows.length) {
      list.innerHTML = '<div class="empty">لا توجد بيانات أو نتائج مطابقة</div>';
      return;
    }

    const groups = new Map();
    rows.forEach(r => {
      const area = (r.city || "").trim() || "منطقة غير محددة";
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(r);
    });

    list.innerHTML = [...groups.entries()]
      .sort((a,b) => a[0].localeCompare(b[0], "ar"))
      .map(([area, riders]) => `
        <section class="area-box">
          <header class="area-heading">
            <div class="area-title"><span class="area-pin">📍</span><span>${esc(area)}</span></div>
            <span class="area-count">${riders.length} مندوب</span>
          </header>
          <div class="area-riders">${riders.map(card).join("")}</div>
        </section>`).join("");
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }


  // ALABTAL Android rider-card actions
  const managerFormCache = new Map();
  const supplyOptions = ["ساعة","ساعتين","3 ساعات","4 ساعات","5 ساعات","6 ساعات","7 ساعات","8 ساعات"];
  const supplyNumbers = {"ساعة":1,"ساعتين":2,"3 ساعات":3,"4 ساعات":4,"5 ساعات":5,"6 ساعات":6,"7 ساعات":7,"8 ساعات":8};

  function riderActionMessage(message) {
    let el = document.getElementById("riderActionMessage");
    if (!el) {
      el = document.createElement("div");
      el.id = "riderActionMessage";
      el.style.cssText = "position:fixed;z-index:99999;bottom:22px;left:14px;right:14px;padding:13px 16px;border-radius:14px;background:#17212b;color:white;font-size:13px;font-weight:700;text-align:center;box-shadow:0 8px 28px #0005";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.style.display = "none", 3500);
  }

  function riderActionPhone(raw) {
    const keys = /^(phone|phoneNumber|phone_number|mobile|mobileNumber|mobile_number|contactNumber|contact_number|whatsapp|whatsAppNumber|telephone|tel)$/i;
    const seen = new Set();
    function scan(o, depth) {
      if (!o || typeof o !== "object" || depth > 5 || seen.has(o)) return "";
      seen.add(o);
      for (const [k,v] of Object.entries(o)) {
        if (keys.test(k) && v != null) {
          const n = String(v).replace(/[^0-9+]/g, "");
          if (n.replace(/\D/g, "").length >= 10) return n;
        }
      }
      for (const v of Object.values(o)) {
        const found = scan(v, depth + 1);
        if (found) return found;
      }
      return "";
    }
    return scan(raw, 0);
  }

  function managerActionUrl(mgr, action, d) {
    const e = mgr.entryIds || {}, v = mgr.entryValues || {}, q = {};
    if (e.typeSelectEntry) q[e.typeSelectEntry] = "شيفتات الطيارين";

    if (action === "break") {
      if (e.requestTypeEntry) q[e.requestTypeEntry] = v.breakRequestType || "فك بريك";
      if (e.breakRiderIdEntry) q[e.breakRiderIdEntry] = d.empId;
      if (e.breakCityEntry) q[e.breakCityEntry] = d.city;
      if (e.lockActionEntry && v.breakActionValue) q[e.lockActionEntry] = v.breakActionValue;
      if (e.breakReasonEntry) q[e.breakReasonEntry] = v.breakReasonText || "طلب المندوب فك البريك من التطبيق";
    } else if (action === "lock") {
      if (e.requestTypeEntry) q[e.requestTypeEntry] = v.lockRequestType || "قفل او رفع او فتح شيفت";
      if (e.lockActionEntry) q[e.lockActionEntry] = v.lockActionValue || "قفل شيفت";
      if (e.lockReasonEntry) q[e.lockReasonEntry] = "نلغي المد بعد اذنكم وراه شغل تاني";
      if (e.lockReasonDetailEntry) q[e.lockReasonDetailEntry] = "ط ع ن 1256";
      if (e.lockRiderIdEntry) q[e.lockRiderIdEntry] = d.empId;
      if (e.lockCityEntry) q[e.lockCityEntry] = d.city;
    } else if (action === "supply") {
      if (e.requestTypeEntry) q[e.requestTypeEntry] = v.supplyRequestType || "تزويدات شيفتات الطيارين";
      if (e.supplyHoursEntry) {
        q[e.supplyHoursEntry] = d.hours;
        const n = supplyNumbers[d.hours];
        if (n) {
          let base = d.shiftEnd ? new Date(d.shiftEnd) : null;
          if (!base || Number.isNaN(base.getTime())) base = new Date();
          const target = new Date(base.getTime() + n * 3600000);
          q[e.supplyHoursEntry + "_hour"] = target.getHours();
          q[e.supplyHoursEntry + "_minute"] = target.getMinutes();
        }
      }
      if (e.supplyRiderIdEntry) q[e.supplyRiderIdEntry] = d.empId;
      if (e.supplyCityEntry) q[e.supplyCityEntry] = d.city;
    }

    const query = Object.entries(q)
      .filter(([,v]) => v != null && v !== "")
      .map(([k,v]) => k + "=" + encodeURIComponent(v)).join("&");
    return String(mgr.formUrl || "").split("?")[0] + (query ? "?usp=pp_url&" + query : "");
  }

  function openManagerFormInside(url, action) {
    const dialog = document.getElementById("alabtalManagerFormDialog");
    if (dialog) dialog.remove();

    if (window.AndroidNotifications &&
        typeof window.AndroidNotifications.openExternal === "function") {
      window.AndroidNotifications.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  }

  async function runRiderManagerAction(rider, action, hours) {
    if (!rider || !rider.id || rider.id === "—") {
      riderActionMessage("رقم المندوب غير متاح");
      return;
    }
    riderActionMessage("جارٍ تجهيز فورم مدير المنطقة…");
    const id = String(rider.id);
    try {
      if (!managerFormCache.has(id)) {
        managerFormCache.set(id, fetch("/api/rider-manager-form?empId=" + encodeURIComponent(id), {
          cache: "no-store", credentials: "same-origin"
        }).then(async r => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "تعذر جلب فورم المدير");
          return data;
        }).catch(err => {
          managerFormCache.delete(id);
          throw err;
        }));
      }
      const mgr = await managerFormCache.get(id);
      if (!mgr || !mgr.ok || !mgr.formUrl) {
        if (mgr && mgr.managerUsername) riderActionMessage('مدير المنطقة "' + mgr.managerUsername + '" لم يضف رابط الفورم');
        else if (mgr && mgr.supervisorName) riderActionMessage('المشرف "' + mgr.supervisorName + '" غير مربوط بمدير منطقة');
        else riderActionMessage("لم أجد فورم مدير المنطقة لهذا المندوب");
        return;
      }
      const url = managerActionUrl(mgr, action, {
        empId: id, city: rider.city, hours, shiftEnd: rider.shiftEnd
      });
      if (!/^https:\/\//i.test(url)) {
        riderActionMessage("رابط فورم المدير غير صالح");
        return;
      }
      openManagerFormInside(url, action);
    } catch (err) {
      riderActionMessage(err.message || "تعذر تحميل فورم مدير المنطقة");
    }
  }

  function showRiderSupplyOptions(rider) {
    document.getElementById("alabtalSupplyDialog")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "alabtalSupplyDialog";
    overlay.className = "supply-dialog-overlay";
    overlay.innerHTML = `
      <section class="supply-dialog" role="dialog" aria-modal="true" aria-label="اختيار ساعات التزويد">
        <div class="supply-dialog-head"><b>＋ تزويد الشيفت</b><button type="button" data-supply-close aria-label="إغلاق">✕</button></div>
        <p>اختار عدد ساعات التزويد للمندوب</p>
        <div class="supply-hours-grid">
          ${supplyOptions.map((label,i)=>`<button type="button" class="supply-hour-option" data-hours-index="${i+1}"><b>${i+1}</b><span>${label}</span></button>`).join("")}
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const closeSupplyDialog = () => {
      overlay.remove();
      window.removeEventListener("keydown", onSupplyKeydown);
      window.removeEventListener("popstate", onSupplyBack);
    };
    const onSupplyKeydown = event => {
      if (event.key === "Escape" && overlay.isConnected) closeSupplyDialog();
    };
    const onSupplyBack = () => {
      if (overlay.isConnected) closeSupplyDialog();
    };
    window.addEventListener("keydown", onSupplyKeydown);
    window.addEventListener("popstate", onSupplyBack);
    overlay.addEventListener("click", event => {
      if (event.target === overlay || event.target.closest("[data-supply-close]")) {
        closeSupplyDialog();
        return;
      }
      const option = event.target.closest("[data-hours-index]");
      if (!option) return;
      const index = Number(option.dataset.hoursIndex);
      closeSupplyDialog();
      if (index >= 1 && index <= 8) runRiderManagerAction(rider, "supply", supplyOptions[index - 1]);
    });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-rider-action]");
    if (!button) return;
    const card = button.closest(".rider");
    if (!card) return;
    event.preventDefault();

    const rider = data.find(r => String(r.id) === String(card.dataset.riderId));
    if (!rider) {
      riderActionMessage("بيانات المندوب غير متاحة؛ حدّث اللايف");
      return;
    }

    const action = button.dataset.riderAction;
    if (action === "lock" || action === "break") {
      runRiderManagerAction(rider, action);
    } else if (action === "supply") {
      showRiderSupplyOptions(rider);
    } else if (action === "call" || action === "whatsapp") {
      let phone = riderActionPhone(rider.raw);
      if (!phone) {
        riderActionMessage("رقم الهاتف غير موجود في بيانات المندوب");
        return;
      }
      let digits = phone.replace(/\D/g, "");
      if (digits.startsWith("00")) digits = digits.slice(2);
      if (digits.startsWith("0")) digits = "20" + digits.slice(1);
      else if (digits.length === 10 && digits.startsWith("1")) digits = "20" + digits;
      window.location.href = action === "call" ? "tel:+" + digits : "https://wa.me/" + digits;
    }
  });

  async function loadData() {
    if (busy) return;
    busy = true;
    if (!data.length) list.innerHTML = '<div class="empty">جارٍ تحميل بيانات المناديب...</div>';
    try {
      const session = await fetch("/api/session", {cache:"no-store"});
      if (session.status === 401) {
        showLogin("سجّل الدخول لعرض البيانات الحقيقية");
        list.innerHTML = "";
        return;
      }
      if (!session.ok) throw new Error("تعذر التحقق من جلسة الدخول");

      const city = "tanta";
      if (city === null || !city.trim()) {
        list.innerHTML = '<div class="empty">لم يتم اختيار مدينة</div>';
        return;
      }

      const res = await fetch("/api/live-ops?city=" + encodeURIComponent(city.trim()), {
        cache:"no-store",
        credentials:"same-origin"
      });
      const result = await res.json();
      liveSummaryStats = result && !Array.isArray(result) &&
        result.stats && typeof result.stats === "object"
          ? result.stats : null;
      if (res.status === 401) {
        showLogin("انتهت الجلسة؛ سجّل الدخول مرة أخرى");
        return;
      }
      if (!res.ok) throw new Error(result.error || "فشل تحميل بيانات المناديب");

      let records = Array.isArray(result) ? result :
        (Array.isArray(result.cards) ? result.cards :
        Array.isArray(result.riders) ? result.riders :
        Array.isArray(result.data) ? result.data :
        Array.isArray(result.items) ? result.items : []);

      if (!records.length) {
        list.innerHTML = '<div class="empty">الطلب نجح لكن لم أجد قائمة مناديب في الاستجابة. راجع شكل JSON في سجل البروكسي.</div>';
        console.log("Live response structure:", Object.keys(result || {}));
        return;
      }
      data = records.map(normalize);
      window.alabtalRiderData = data;
      notifyRiderStatusChanges(data);

      // مصدر الحجوزات الأصلي، مستقل عن بيانات اللايف.
      try {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(new Date());
        const part = key => parts.find(x => x.type === key)?.value || "";
        const day = `${part("year")}-${part("month")}-${part("day")}`;
        const bookingRes = await fetch(
          "/api/notbooked?city=" + encodeURIComponent(city.trim()) + "&day=" + day,
          { cache: "no-store", credentials: "same-origin" }
        );
        const bookingJson = await bookingRes.json();
        if (!bookingRes.ok || bookingJson.ok === false) {
          throw new Error(bookingJson.error || "تعذر تحميل الحجوزات الأصلية");
        }
        officialBookingData = bookingJson;
      } catch (bookingError) {
        officialBookingData = null;
        console.error("[Official bookings]", bookingError);
      }




      updateDashboardStats();
      render();
      if (activeView === "bookings") renderBookings();
    } catch (error) {
      list.innerHTML = '<div class="empty">' + esc(error.message || "حدث خطأ") + '</div>';
    } finally {
      busy = false;
    }
  }

  document.querySelectorAll("#filters [data-status]").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#filters [data-status]").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    status = b.dataset.status || "الكل";
    render();
  }));
  $("#cityTabs")?.addEventListener("click", e => {
    const button = e.target.closest("button[data-city]");
    if (!button) return;
    selectedCity = button.dataset.city || "الكل";
    render();
  });

  const refreshLiveBtn = document.getElementById("refreshLiveBtn");
  refreshLiveBtn?.addEventListener("click", async () => {
    if (busy) return;
    refreshLiveBtn.disabled = true;
    refreshLiveBtn.textContent = "⟳ جاري التحديث...";
    try {
      await loadData();
    } finally {
      refreshLiveBtn.disabled = false;
      refreshLiveBtn.textContent = "↻ تحديث";
    }
  });


  // Sidebar navigation and shift bookings view
  const sideMenu = document.getElementById("sideMenu");
  const menuBackdrop = document.getElementById("menuBackdrop");
  const mainWrap = document.getElementById("mainWrap");
  const bookingsView = document.getElementById("bookingsView");
  let activeView = "live";

  function closeMenu() {
    sideMenu?.classList.remove("open");
    menuBackdrop?.classList.remove("show");
    sideMenu?.setAttribute("aria-hidden", "true");
  }
  function openMenu() {
    sideMenu?.classList.add("open");
    menuBackdrop?.classList.add("show");
    sideMenu?.setAttribute("aria-hidden", "false");
  }
  document.getElementById("menuToggle")?.addEventListener("click", openMenu);
  document.getElementById("menuClose")?.addEventListener("click", closeMenu);
  menuBackdrop?.addEventListener("click", closeMenu);

  let officialBookingData = null;

  function renderBookings() {
    const target = document.getElementById("bookingList");
    if (!target) return;
    const parent = target.parentElement;

    if (!document.getElementById("bookingTools")) {
      const tools = document.createElement("div");
      tools.id = "bookingTools";
      tools.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0";
      tools.innerHTML = `
        <select id="bookingFilter"
          style="width:100%;padding:12px;border-radius:10px;border:1px solid #444;background:#171717;color:#fff">
          <option value="all">كل المناديب</option>
          <option value="booked">حاجزين</option>
          <option value="unbooked">غير حاجزين</option>
        </select>`;
      parent.insertBefore(tools, target);
      document.getElementById("bookingFilter").addEventListener("change", renderBookings);
    }

    const res = officialBookingData;
    if (!res || !Array.isArray(res.booked) || !Array.isArray(res.notBooked)) {
      target.innerHTML = '<div class="empty">جارٍ تحميل بيانات الحجوزات الأصلية...</div>';
      return;
    }

    const bookedRows = res.booked.map(r => ({ ...r, __officialBooked: true }));
    const unbookedRows = res.notBooked.map(r => ({ ...r, __officialBooked: false }));
    const rosterTotal = Number(res.rosterTotal) || bookedRows.length + unbookedRows.length;
    const pct = rosterTotal ? Math.round(bookedRows.length / rosterTotal * 100) : 0;

    const get = (r, keys, fallback = "") => {
      for (const k of keys) {
        const v = r?.[k];
        if (v !== undefined && v !== null && typeof v !== "object" && String(v).trim()) return String(v);
      }
      return fallback;
    };

    const search = (document.getElementById("bookingSearch")?.value || "").trim().toLowerCase();
    const mode = document.getElementById("bookingFilter")?.value || "all";
    let rows = [...bookedRows, ...unbookedRows].map(r => ({
      raw: r,
      name: get(r, ["name", "riderName", "fullName", "employeeName", "empName"], "بدون اسم"),
      id: get(r, ["id", "empId", "employeeId", "riderId", "code"], "—"),
      city: get(r, ["cityName", "city", "city_name", "zone"], "طنطا"),
      supervisor: get(r, ["supervisorName", "supervisor", "managerName"], "—"),
      booked: r.__officialBooked
    }));

    rows = rows.filter(r =>
      (mode === "all" || (mode === "booked" ? r.booked : !r.booked)) &&
      `${r.name} ${r.id} ${r.city} ${r.supervisor}`.toLowerCase().includes(search)
    );
    rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const totalEl = document.getElementById("bookingTotal");
    const bookedEl = document.getElementById("bookingTomorrow");
    if (totalEl) totalEl.textContent = rosterTotal;
    if (bookedEl) bookedEl.textContent = bookedRows.length;

    const percentEl = document.getElementById("bookingPercent");
    const progressEl = document.getElementById("bookingProgressBar");
    const detailEl = document.getElementById("bookingPercentDetail");
    if (percentEl) percentEl.textContent = pct + "%";
    if (progressEl) progressEl.style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (detailEl) detailEl.textContent =
      `${bookedRows.length} من ${rosterTotal} مندوب · ${unbookedRows.length} بدون حجز`;

    let summary = document.getElementById("bookingFilterSummary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "bookingFilterSummary";
      summary.style.cssText = "margin:8px 0 14px;color:var(--muted,#aaa);font-size:14px;line-height:1.9";
      parent.insertBefore(summary, target);
    }
    summary.textContent =
      `نسبة الحجز: ${pct}% · القوة الأصلية: ${rosterTotal} · ` +
      `${bookedRows.length} حاجز · ${unbookedRows.length} لسه ما حجزوش · المعروض: ${rows.length}`;

    if (!rows.length) {
      target.innerHTML = '<div class="empty">لا توجد نتائج مطابقة للفلاتر الحالية.</div>';
      return;
    }

    target.innerHTML = rows.map(r => `
      <article class="booking-card">
        <div class="booking-card-head">
          <div><strong>${esc(r.name)}</strong><small>كود المندوب: ${esc(r.id)}</small></div>
          <span class="booking-state ${r.booked ? "is-booked" : "not-booked"}">
            ${r.booked ? "حاجز" : "لسه ما حجزش"}
          </span>
        </div>
        <div class="booking-meta">
          <span>📍 ${esc(r.city)}</span>
          <span>👤 ${esc(r.supervisor)}</span>
        </div>
      </article>`).join("");
  }

  document.querySelectorAll(".side-link[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      document.querySelectorAll(".side-link").forEach(x => x.classList.toggle("active", x === button));
      document.body.classList.toggle("bookings-mode", activeView === "bookings");
      if (bookingsView) bookingsView.hidden = activeView !== "bookings";
      if (mainWrap) {
        [...mainWrap.children].forEach(child => {
          if (child === bookingsView || child.tagName === "FOOTER") return;
          child.hidden = activeView === "bookings";
        });
      }
      closeMenu();
      if (activeView === "bookings") renderBookings();
    });
  });
  document.getElementById("bookingSearch")?.addEventListener("input", renderBookings);
  document.getElementById("refreshBookingsBtn")?.addEventListener("click", async () => {
    await loadData();
    renderBookings();
  });

  // ALABTAL_AUTO_REFRESH_30S
  let alabtalAutoRefreshBusy = false;
  let alabtalNextRefreshAt = Date.now() + 30000;

  setInterval(async () => {
    const countdown = document.getElementById("liveRefreshCountdown");
    const seconds = Math.max(0, Math.ceil((alabtalNextRefreshAt - Date.now()) / 1000));

    if (countdown) {
      countdown.textContent = document.hidden
        ? "التحديث عند فتح التطبيق"
        : (busy || alabtalAutoRefreshBusy
            ? "جارٍ التحديث..."
            : `تحديث خلال ${seconds}ث`);
    }

    if (document.hidden || Date.now() < alabtalNextRefreshAt) return;

    if (busy || alabtalAutoRefreshBusy) {
      alabtalNextRefreshAt = Date.now() + 1000;
      return;
    }

    alabtalNextRefreshAt = Date.now() + 30000;
    alabtalAutoRefreshBusy = true;
    try {
      await loadData();
    } catch (error) {
      console.error("[ALABTAL auto refresh]", error);
    } finally {
      alabtalAutoRefreshBusy = false;
    }
  }, 1000);

  loadData();
})();


// ALABTAL HEADER CONTROLS
(function () {
  const $ = id => document.getElementById(id);

  // القائمة المنسدلة العلوية
  $("headerViewSelect")?.addEventListener("change", e => {
    document.querySelector(`.side-link[data-view="${e.target.value}"]`)?.click();
  });
  document.querySelectorAll(".side-link[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      const select = $("headerViewSelect");
      if (select) select.value = button.dataset.view || "live";
    });
  });

  // لوحة الإشعارات
  const bell = $("notificationsBtn");
  if (bell && !$("notificationsPanel")) {
    const panel = document.createElement("section");
    panel.id = "notificationsPanel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="notifications-head">
        <strong>الإشعارات</strong>
        <button id="clearNotificationsBtn" type="button">مسح الكل</button>
      </div>
      <div id="notificationsList"><p class="notification-empty">لا توجد إشعارات جديدة</p></div>`;
    document.body.appendChild(panel);

    const renderNotifications = () => {
      const items = window.alabtalNotifications || [];
      const count = $("notificationCount");
      const target = $("notificationsList");
      if (count) {
        count.textContent = String(items.length);
        count.hidden = items.length === 0;
      }
      if (target) {
        target.innerHTML = items.length
          ? items.map(item => `<article class="notification-item"><span>${String(item.text).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</span><small>${item.time || ""}</small></article>`).join("")
          : '<p class="notification-empty">لا توجد إشعارات جديدة</p>';
      }
    };

    bell.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderNotifications();
    });
    $("clearNotificationsBtn")?.addEventListener("click", () => {
      window.alabtalNotifications = [];
      saveAlabtalNotifications();
      renderNotifications();
    });
    window.addEventListener("alabtal-notifications-updated", renderNotifications);
    document.addEventListener("click", e => {
      if (!panel.contains(e.target) && !bell.contains(e.target)) panel.hidden = true;
    });
    renderNotifications();
  }

  // تسجيل الخروج من جلسة البروكسي الفعلية
  $("alabtalLogoutBtn")?.addEventListener("click", async () => {
    const btn = $("alabtalLogoutBtn");
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "جارٍ الخروج...";
    try {
      const res = await fetch("/api/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store"
      });
      if (!res.ok) throw new Error("تعذر تسجيل الخروج");
      location.reload();
    } catch (error) {
      alert(error.message || "تعذر الاتصال");
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
})();

document.addEventListener("click", function(e) {
  if (e.target.closest("button, a, input, select, textarea, label")) return;
  const card = e.target.closest(".rider");
  if (!card) return;

  const riders = window.alabtalRiderData || [];
  const rider = riders.find(r =>
    r.name === card.dataset.riderName && r.id === card.dataset.riderId
  );
  if (!rider) return;

  const safe = v => String(v ?? "—").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])
  );
  const findField = (obj, pattern) => {
    const seen = new Set();
    function walk(value, depth) {
      if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return "";
      seen.add(value);
      for (const [key, val] of Object.entries(value)) {
        if (pattern.test(key) && val != null && typeof val !== "object" && String(val).trim()) return String(val);
      }
      for (const val of Object.values(value)) {
        const found = walk(val, depth + 1);
        if (found) return found;
      }
      return "";
    }
    return obj ? (walk(obj, 0) || "—") : "—";
  };

  const order = rider.activeOrder;
  const orderStatus = findField(order, /orderStatus|status|state|currentStatus/i);
  const orderId = findField(order, /orderId|order_id|id|code/i);
  const restaurant = findField(order, /vendor|restaurant|merchant|shop|store|name/i);
  const pickup = findField(order, /pickup|pick.?up|collect|restaurantAddress|fromAddress/i);
  const dropoff = findField(order, /drop.?off|deliveryAddress|customerAddress|destination|deliverTo/i);

  let page = document.getElementById("riderDetailPage");
  if (!page) {
    page = document.createElement("section");
    page.id = "riderDetailPage";
    page.className = "rider-detail-page";
    page.innerHTML = '<header class="detail-top"><button type="button" id="detailBackBtn">‹ رجوع</button><strong>تفاصيل المندوب</strong><span>ALABTAL</span></header><div id="riderDetailContent"></div>';
    document.body.appendChild(page);
    page.querySelector("#detailBackBtn").addEventListener("click", () => {
      page.classList.remove("open");
      document.body.classList.remove("detail-page-open");
    });
  }

  document.getElementById("riderDetailContent").innerHTML = `
    <article class="detail-rider-card">
      <div class="detail-rider-hero"><span class="detail-avatar">🛵</span><div><small>AL ABTAL · طنطا</small><h2>${safe(rider.name)}</h2><p>كود المندوب: ${safe(rider.id)}</p></div></div>
      <div class="detail-status-row"><span class="rider-state-pill">${safe(rider.status)}</span><span class="order-status-badge ${order ? "has-order" : "no-order"}">${order ? "● معاه أوردر" : "○ مفيش أوردر"}</span></div>
      <h3>تفاصيل الأوردر</h3>
      ${order ? `<div class="detail-field"><span>حالة الأوردر</span><b>${safe(orderStatus)}</b></div><div class="detail-field"><span>رقم الأوردر</span><b>${safe(orderId)}</b></div><div class="detail-field"><span>المطعم</span><b>${safe(restaurant)}</b></div><div class="detail-field"><span>عنوان الاستلام</span><b>${safe(pickup)}</b></div><div class="detail-field"><span>عنوان العميل</span><b>${safe(dropoff)}</b></div>` : '<div class="detail-no-order">المندوب لا يحمل أوردرًا نشطًا حاليًا.</div>'}
      <h3>بيانات المندوب</h3>
      <div class="detail-field"><span>المدينة</span><b>${safe(rider.city)}</b></div><div class="detail-field"><span>المشرف</span><b>${safe(rider.supervisor)}</b></div><div class="detail-field"><span>بداية الشيفت</span><b>${safe(window.formatShiftTime ? window.formatShiftTime(rider.shiftStart) : rider.shiftStart)}</b></div><div class="detail-field"><span>نهاية الشيفت</span><b>${safe(window.formatShiftTime ? window.formatShiftTime(rider.shiftEnd) : rider.shiftEnd)}</b></div>
      <div class="detail-metrics"><div><b>${rider.orders}</b><small>أوردر</small></div><div><b>${safe(rider.utr)}</b><small>UTR</small></div><div><b>${safe(rider.hours)}</b><small>ساعة</small></div><div><b>${rider.breaks}</b><small>بريك</small></div></div>
      <div class="detail-wallet"><span>💰 المحفظة</span><b>${safe(rider.wallet)}</b></div>
    </article>`;
  page.classList.add("open");
  document.body.classList.add("detail-page-open");
});


// ALABTAL_TYPEWRITER
(function () {
  const target = document.getElementById("brandTypingText");
  if (!target) return;
  const words = ["ALABTAL", "TALABAT", "طنطا"];
  let wordIndex = 0, charIndex = 0, deleting = false;
  function tick() {
    const word = words[wordIndex];
    target.textContent = word.slice(0, charIndex);
    if (!deleting) {
      charIndex++;
      if (charIndex > word.length) {
        deleting = true;
        setTimeout(tick, 1000);
        return;
      }
    } else {
      charIndex--;
      if (charIndex < 0) {
        deleting = false;
        charIndex = 0;
        wordIndex = (wordIndex + 1) % words.length;
      }
    }
    setTimeout(tick, deleting ? 65 : 135);
  }
  tick();
})();
