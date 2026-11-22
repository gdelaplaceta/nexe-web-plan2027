// Verificación pública de CSV. Escribe todo con textContent: nunca innerHTML.
(function () {
  var form = document.getElementById('form-csv');
  var input = document.getElementById('csv');
  var out = document.getElementById('resultado');
  var PATTERN = /^NXE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

  function normalize(value) {
    var raw = String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (raw.indexOf('NXE') === 0) raw = raw.slice(3);
    if (raw.length !== 12) return null;
    var code = 'NXE-' + raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
    return PATTERN.test(code) ? code : null;
  }

  function row(dl, label, value) {
    if (value === null || value === undefined || value === '') return;
    var dt = document.createElement('dt'); dt.textContent = label;
    var dd = document.createElement('dd'); dd.textContent = value;
    dl.appendChild(dt); dl.appendChild(dd);
  }

  function fecha(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  }

  function render(data, status) {
    out.textContent = '';
    var ok = status === 200 && data.valido;
    var card = document.createElement('div');
    card.className = 'card ' + (ok ? (data.textoVigente === false ? 'warn' : 'ok') : 'bad');
    var title = document.createElement('div');
    title.className = 'estado';
    title.textContent = ok
      ? (data.tipo === 'convenio' ? 'Documento auténtico' : (data.textoVigente ? 'Firma auténtica' : 'Firma auténtica (versión anterior)'))
      : 'No verificado';
    card.appendChild(title);
    var msg = document.createElement('p');
    msg.textContent = data.mensaje || '';
    card.appendChild(msg);

    if (data.valido) {
      var dl = document.createElement('dl');
      row(dl, 'Documento', data.titulo);
      row(dl, 'Ejercicio', data.ano);
      if (data.firmante) {
        row(dl, 'Firmante', data.firmante.nombre);
        row(dl, 'Cargo', data.firmante.cargo);
        row(dl, 'DIP', data.firmante.dip);
      }
      row(dl, 'Fecha', fecha(data.fecha));
      row(dl, 'Convenio', data.convenioAprobado ? 'Aprobado' : 'Pendiente de firma');
      card.appendChild(dl);
    }
    out.appendChild(card);
  }

  function verify(code) {
    out.textContent = 'Comprobando…';
    fetch('/api/verificar?csv=' + encodeURIComponent(code), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, data: j }; }); })
      .then(function (res) { render(res.data, res.status); })
      .catch(function () {
        out.textContent = '';
        var p = document.createElement('p');
        p.className = 'card bad';
        p.textContent = 'No se pudo conectar con el servicio de verificación. Inténtalo de nuevo.';
        out.appendChild(p);
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var code = normalize(input.value);
    if (!code) {
      out.textContent = '';
      var p = document.createElement('p');
      p.className = 'card bad';
      p.textContent = 'El código no tiene el formato NXE-XXXX-XXXX-XXXX.';
      out.appendChild(p);
      input.focus();
      return;
    }
    input.value = code;
    verify(code);
  });

  // Enlace directo: /verificar?csv=NXE-XXXX-XXXX-XXXX (por ejemplo, desde un código QR).
  var params = new URLSearchParams(window.location.search);
  var preset = normalize(params.get('csv'));
  if (preset) { input.value = preset; verify(preset); }
})();
