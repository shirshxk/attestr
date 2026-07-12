import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Logo, { LogoMark } from '../Shared/Logo'
import {
  IconGrid, IconKey, IconShield, IconChart, IconList, IconPlus,
  IconBox, IconUsers, IconLogout, IconSun, IconMoon,
  IconChevronLeft, IconChevronRight, IconTree, IconInbox,
} from './icons'

const NAV = {
  super_admin: [
    { path:'/admin',           label:'Overview',        Icon: IconGrid },
    { path:'/admin/users',     label:'User management', Icon: IconUsers },
    { path:'/admin/workspaces',label:'Workspaces',      Icon: IconBox },
    { path:'/admin/requests',  label:'Vendor requests', Icon: IconInbox },
    { path:'/admin/keys',      label:'Key management',  Icon: IconKey },
    { path:'/admin/log',       label:'Audit log',       Icon: IconShield },
    { path:'/admin/trust',     label:'Trust Center',    Icon: IconChart },
  ],
  admin: [
    { path:'/admin',          label:'Overview',        Icon: IconGrid },
    { path:'/admin/users',    label:'User management', Icon: IconUsers },
    { path:'/admin/requests', label:'Vendor requests', Icon: IconInbox },
    { path:'/admin/log',      label:'Audit log',       Icon: IconShield },
    { path:'/admin/trust',    label:'Trust Center',    Icon: IconChart },
  ],
  auditor: [
    { path:'/auditor',         label:'Pipeline',        Icon: IconGrid },
    { path:'/auditor/new',     label:'New questionnaire',Icon: IconPlus },
    { path:'/auditor/vendors', label:'Vendors',         Icon: IconUsers },
    { path:'/auditor/bundle',  label:'Bundle viewer',   Icon: IconBox },
    { path:'/auditor/verify',  label:'Offline verify',  Icon: IconShield },
    // Trust Center appended only for privileged auditors (see navFor)
  ],
  vendor: [
    { path:'/vendor',       label:'My questionnaires', Icon: IconList },
  ],
}

// Resolve nav for an org, honoring role aliases and the privileged-auditor flag.
function navFor(org) {
  let role = org?.role || 'vendor'
  if (role === 'ca_admin') role = 'super_admin'
  const base = (NAV[role] || []).slice()
  if (role === 'auditor' && org?.is_privileged) {
    base.push({ path:'/auditor/trust', label:'Trust Center', Icon: IconChart })
  }
  // Workspace admins (auditor or vendor) get a "My team" panel to invite teammates.
  if (org?.is_workspace_admin && (role === 'auditor' || role === 'vendor')) {
    const teamPath = role === 'auditor' ? '/auditor/team' : '/vendor/team'
    base.push({ path: teamPath, label: 'My team', Icon: IconUsers })
  }
  return base
}

const ROLE_LABEL = { super_admin:'Super Admin', ca_admin:'Super Admin', admin:'Admin', auditor:'Auditor', vendor:'Vendor' }
const ROLE_COLOR = { super_admin:'bg-amber-500', ca_admin:'bg-amber-500', admin:'bg-orange-500', auditor:'bg-blue-600', vendor:'bg-emerald-600' }

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('attestr-sidebar') === 'collapsed'
  )
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )
  const { org, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const role  = (org?.role === 'ca_admin' ? 'super_admin' : org?.role) || 'vendor'
  const items = navFor(org)
  const W = collapsed ? 64 : 232

  useEffect(() => {
    localStorage.setItem('attestr-sidebar', collapsed ? 'collapsed' : 'open')
  }, [collapsed])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('attestr-theme', next ? 'dark' : 'light')
  }

  return (
    <aside
      className="fixed top-0 left-0 h-screen z-50 flex flex-col bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 transition-all duration-200"
      style={{ width: W }}
    >
      {/* Logo + collapse */}
      <div className="h-14 flex items-center justify-between px-3.5 border-b border-gray-100 dark:border-neutral-800 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center">
            <Logo className="h-9" />
          </div>
        )}
        {collapsed && (
          <div className="mx-auto">
            <LogoMark size={26} />
          </div>
        )}
        {!collapsed && (
          <button onClick={() => setCollapsed(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors">
            <IconChevronLeft width={16} height={16}/>
          </button>
        )}
      </div>

      {collapsed && (
        <button onClick={() => setCollapsed(false)}
          className="mx-auto mt-2 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors">
          <IconChevronRight width={16} height={16}/>
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 py-3 px-2.5 space-y-1 overflow-y-auto">
        {!collapsed && (
          <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-gray-400 dark:text-neutral-600 uppercase">
            {ROLE_LABEL[role]}
          </div>
        )}
        {items.map(({ path, label, Icon }) => {
          const active = location.pathname === path
          return (
            <button key={path} onClick={() => navigate(path)}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 rounded-lg transition-colors
                ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                ${active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white'}`}>
              <Icon width={18} height={18} className="flex-shrink-0"/>
              {!collapsed && <span className="text-[13px] font-medium">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-gray-100 dark:border-neutral-800 p-2.5 space-y-1 flex-shrink-0">
        <button onClick={toggleTheme}
          title={collapsed ? 'Toggle theme' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors
            ${collapsed ? 'justify-center py-2.5' : 'px-3 py-2'}`}>
          {dark ? <IconSun width={18} height={18}/> : <IconMoon width={18} height={18}/>}
          {!collapsed && <span className="text-[13px] font-medium">{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        <button onClick={logout}
          title={collapsed ? 'Sign out' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors
            ${collapsed ? 'justify-center py-2.5' : 'px-3 py-2'}`}>
          <IconLogout width={18} height={18}/>
          {!collapsed && <span className="text-[13px] font-medium">Sign out</span>}
        </button>

        <div className={`flex items-center gap-2.5 pt-1 ${collapsed ? 'justify-center' : 'px-1'}`}>
          <div className={`w-8 h-8 rounded-lg ${ROLE_COLOR[role]} flex items-center justify-center flex-shrink-0`}>
            <span className="text-white text-[12px] font-bold">{(org?.org_name||'?')[0].toUpperCase()}</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white truncate">{org?.org_name}</div>
              <div className="text-[11px] text-gray-400 dark:text-neutral-500">{ROLE_LABEL[role]}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
