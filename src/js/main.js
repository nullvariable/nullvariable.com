var header = document.getElementById("header")

document.addEventListener("scroll", function () {
  if (window.scrollY > 10) {
    header.classList.add("scrolled")
  } else {
    header.classList.remove("scrolled")
  }
})
