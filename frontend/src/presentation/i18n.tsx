// Два языка интерфейса. Строки пишутся парой прямо в разметке: t('по-русски', 'қазақша').
// Казахские тексты нужно вычитать носителю языка перед сдачей.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { DeptId, MarkState, SheetStatus, SheetType } from '../domain/clearance'

export type Lang = 'ru' | 'kz'

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'ru', setLang: () => {} })

function initial(): Lang {
  try {
    return localStorage.getItem('aitu-lang') === 'kz' ? 'kz' : 'ru'
  } catch {
    return 'ru'
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial)
  useEffect(() => {
    document.documentElement.lang = lang === 'kz' ? 'kk' : 'ru'
    try {
      localStorage.setItem('aitu-lang', lang)
    } catch {
      // язык просто не запомнится
    }
  }, [lang])
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>
}

export function useLang() {
  return useContext(LangCtx)
}

export function useT() {
  const { lang } = useLang()
  return (ru: string, kz: string) => (lang === 'kz' ? kz : ru)
}

type Pair = [string, string]

export const DEPT_NAMES: Record<DeptId, Pair> = {
  library: ['Библиотека', 'Кітапхана'],
  accounting: ['Бухгалтерия', 'Бухгалтерия'],
  dorm: ['Общежитие', 'Жатақхана'],
  military: ['Военно-учётный стол', 'Әскери есеп үстелі'],
  it: ['IT-отдел', 'IT бөлімі'],
  academic: ['Учебная часть', 'Оқу бөлімі'],
}

export const DEPT_ROOMS: Record<DeptId, Pair> = {
  library: ['Каб. 104, пн–пт 9:00–17:00', '104 каб., дс–жм 9:00–17:00'],
  accounting: ['Каб. 210, пн–пт 9:00–16:00', '210 каб., дс–жм 9:00–16:00'],
  dorm: ['Общежитие, 1 этаж, комендант', 'Жатақхана, 1 қабат, комендант'],
  military: ['Каб. 118, вт и чт 10:00–15:00', '118 каб., сс және бс 10:00–15:00'],
  it: ['Каб. 305, пн–пт 9:00–18:00', '305 каб., дс–жм 9:00–18:00'],
  academic: ['Каб. 201, пн–пт 9:00–17:00', '201 каб., дс–жм 9:00–17:00'],
}

export const SHEET_TYPE_NAMES: Record<SheetType, Pair> = {
  graduation: ['Выпуск', 'Бітіру'],
  expulsion: ['Отчисление', 'Оқудан шығу'],
  transfer: ['Перевод', 'Ауысу'],
  leave: ['Академический отпуск', 'Академиялық демалыс'],
  dorm: ['Выселение из общежития', 'Жатақханадан шығу'],
}

export const STATUS_NAMES: Record<SheetStatus, Pair> = {
  created: ['Создан', 'Құрылды'],
  progress: ['В работе', 'Жұмыста'],
  debt: ['Есть задолженность', 'Берешек бар'],
  closed: ['Закрыт', 'Жабық'],
}

export const MARK_NAMES: Record<MarkState, Pair> = {
  pending: ['Ожидает отметки', 'Белгі күтуде'],
  clear: ['Нет задолженности', 'Берешек жоқ'],
  debt: ['Есть задолженность', 'Берешек бар'],
}

export function usePick() {
  const { lang } = useLang()
  return (p: Pair) => (lang === 'kz' ? p[1] : p[0])
}

// Chrome поставляется без казахской локали: toLocaleDateString('kk-KZ') молча отдаёт «4 ноября».
// Поэтому казахские даты собираем сами, по-русски доверяем браузеру.
const KZ_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан']
const two = (n: number) => String(n).padStart(2, '0')

export function formatKz(iso: string, kind: 'date' | 'dateTime' | 'full'): string {
  const d = new Date(iso)
  const day = `${d.getDate()} ${KZ_MONTHS[d.getMonth()]}`
  if (kind === 'full') return `${d.getFullYear()} жылғы ${day}`
  if (kind === 'dateTime') return `${day}, ${two(d.getHours())}:${two(d.getMinutes())}`
  return day
}

export function useFormat() {
  const { lang } = useLang()
  if (lang === 'kz') {
    return {
      date: (iso: string) => formatKz(iso, 'date'),
      dateTime: (iso: string) => formatKz(iso, 'dateTime'),
      full: (iso: string) => formatKz(iso, 'full'),
    }
  }
  return {
    date: (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    dateTime: (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    full: (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
}
