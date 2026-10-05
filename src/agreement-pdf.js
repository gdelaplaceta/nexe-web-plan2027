import { jsPDF } from 'jspdf'

async function loadLogoDataUrl() {
  const response = await fetch('/nexe-logo.png')
  if (!response.ok) throw new Error(`No se pudo cargar el logo de Nexe (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

window.generateAgreementPdf = async ({ text, dip, acceptedAt, signed }) => {
  const logo = await loadLogoDataUrl()
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const contentWidth = pageWidth - margin * 2
  const title = signed ? 'Convenio aceptado' : 'Borrador de convenio'

  const drawHeader = () => {
    doc.addImage(logo, 'PNG', margin, 12, 42, 17)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(35, 54, 48)
    doc.text('Grupo de La Placeta', pageWidth - margin, 17, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(91, 108, 100)
    doc.text('Convenio de colaboración', pageWidth - margin, 22, { align: 'right' })
    doc.setDrawColor(217, 223, 220)
    doc.line(margin, 34, pageWidth - margin, 34)
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(24, 44, 38)
  doc.text(title, margin, 43)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(72, 87, 80)

  let y = 52
  const rows = String(text || '').replace(/\r\n/g, '\n').split('\n')
  for (const row of rows) {
    const wrapped = doc.splitTextToSize(row || ' ', contentWidth)
    for (const line of wrapped) {
      if (y > pageHeight - 27) {
        doc.addPage()
        drawHeader()
        y = 43
      }
      doc.text(line, margin, y)
      y += 5
    }
  }

  if (y > pageHeight - 37) {
    doc.addPage()
    drawHeader()
    y = 43
  }
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, y + 2, pageWidth - margin, y + 2)
  y += 9
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(signed ? 47 : 154, signed ? 125 : 112, signed ? 91 : 49)
  const signerText = signed
    ? `Firma electrónica interna mediante DIP: ${String(dip || 'no disponible').toUpperCase()}`
    : `BORRADOR · Pendiente de aceptación · DIP: ${String(dip || 'no disponible').toUpperCase()}`
  doc.text(doc.splitTextToSize(signerText, contentWidth), margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(91, 108, 100)
  doc.text(
    signed ? `Fecha y hora de aceptación: ${String(acceptedAt || 'no disponible')}` : 'Este documento no está firmado ni acredita una aceptación.',
    margin,
    y + 6,
  )

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(112, 124, 117)
    doc.text(
      signed ? `Documento de Nexe · Página ${page} de ${pages}` : `Borrador sin firma · Página ${page} de ${pages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' },
    )
  }

  const safeDip = String(dip || 'identidad').replace(/[^a-z0-9-]/gi, '-')
  doc.save(`convenio-${signed ? 'aceptado' : 'borrador'}-${safeDip}.pdf`)
}
