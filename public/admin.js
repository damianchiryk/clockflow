
/* REPLACE your renderEmployees function with this */

function renderEmployees(data) {
  const container = document.getElementById("employeesContainer");

  if (window.innerWidth <= 768) {
    container.innerHTML = `
      <div class="mobile-cards">
        ${data.map(emp => `
          <div class="employee-card">
            <div class="row"><b>${emp.name}</b></div>
            <div class="row">Login: ${emp.login}</div>
            <div class="row">Site: ${emp.site}</div>
            <div class="row">Pay: ${emp.compensationType} £${emp.compensationRate}</div>
            <div class="row">
              <button onclick="editEmployee('${emp.id}')">Edit</button>
              <button onclick="deleteEmployee('${emp.id}')">Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } else {
    renderEmployeesTable(data); // your existing table function
  }
}
