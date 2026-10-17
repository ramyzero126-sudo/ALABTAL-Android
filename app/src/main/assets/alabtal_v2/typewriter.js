(function() {
  function typeWriter(el, text, speed = 55) {
    if (!el || el.dataset.typing === "1") return;
    el.dataset.typing = "1";
    el.classList.remove("typing-done");
    el.textContent = "";
    
    let i = 0;
    function type() {
      if (i < text.length) {
        el.textContent += text.charAt(i);
        i++;
        setTimeout(type, speed);
      } else {
        el.classList.add("typing-done");
        el.dataset.typing = "0";
      }
    }
    type();
  }

  function observeElement(el) {
    if (!el) return;
    
    // لو فيه قيمة جاهزة غير —
    if (el.textContent.trim() !== "—" && el.textContent.trim() !== "") {
      typeWriter(el, el.textContent.trim());
    }

    const observer = new MutationObserver(() => {
      const newText = el.textContent.trim();
      if (newText && newText !== "—" && el.dataset.typing !== "1") {
        typeWriter(el, newText);
      }
    });

    observer.observe(el, { childList: true, characterData: true, subtree: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    observeElement(document.getElementById("bookingTotal"));
    observeElement(document.getElementById("bookingTomorrow"));
    observeElement(document.getElementById("bookingPercent"));
  });
})();
