/**
 * UserProfile.jsx — NexRadar Pro
 * User profile panel with settings, theme, and notifications
 */

import { useState } from 'react'
import clsx from 'clsx'

export default function UserProfile({ user, darkMode, onDarkModeChange, onClose }) {
  const [activeTab, setActiveTab] = useState('profile')
  const [theme, setTheme] = useState('auto') // 'light', 'dark', 'auto'
  const [notifications, setNotifications] = useState({
    volumeSpikes: true,
    gapPlays: true,
    earnings: true,
    priceAlerts: false,
    email: false,
  })

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme)
    if (newTheme === 'light') {
      onDarkModeChange(false)
    } else if (newTheme === 'dark') {
      onDarkModeChange(true)
    } else {
      // Auto mode - detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      onDarkModeChange(prefersDark)
    }
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'theme', label: 'Theme', icon: '🎨' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={clsx(
        'w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden',
        darkMode ? 'bg-[#0d1117]' : 'bg-white'
      )}>
        
        {/* Header */}
        <div className={clsx(
          'flex items-center justify-between px-6 py-4 border-b',
          darkMode ? 'border-white/10 bg-[#161b22]' : 'border-slate-200 bg-slate-50'
        )}>
          <h2 className={clsx('text-xl font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
            User Profile
          </h2>
          <button
            onClick={onClose}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              darkMode
                ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                : 'hover:bg-slate-200 text-slate-600 hover:text-slate-900'
            )}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className={clsx(
          'flex gap-1 px-6 pt-4 border-b',
          darkMode ? 'border-white/10' : 'border-slate-200'
        )}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'px-4 py-2 text-sm font-semibold rounded-t-lg transition-all',
                activeTab === tab.id
                  ? darkMode
                    ? 'bg-[#0d1117] text-cyan-400 border-b-2 border-cyan-400'
                    : 'bg-white text-blue-600 border-b-2 border-blue-600'
                  : darkMode
                    ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              )}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Avatar & Name */}
              <div className="flex items-center gap-4">
                <div className={clsx(
                  'w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black',
                  darkMode
                    ? 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-2 border-cyan-500/30 text-cyan-400'
                    : 'bg-gradient-to-br from-blue-100 to-cyan-100 border-2 border-blue-300 text-blue-600'
                )}>
                  {user?.name?.charAt(0) || 'S'}
                </div>
                <div>
                  <h3 className={clsx('text-2xl font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                    {user?.name || 'Saranya'}
                  </h3>
                  <p className={clsx('text-sm', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                    {user?.role || 'Premium Trader'}
                  </p>
                </div>
              </div>

              {/* Email (Coming Soon) */}
              <div className={clsx(
                'p-4 rounded-lg border',
                darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
              )}>
                <label className={clsx('text-xs font-bold uppercase tracking-wider mb-2 block',
                  darkMode ? 'text-gray-500' : 'text-slate-500')}>
                  Email Address
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="saranya@example.com"
                    disabled
                    className={clsx(
                      'flex-1 px-3 py-2 rounded-lg text-sm border outline-none',
                      darkMode
                        ? 'bg-white/5 border-white/10 text-gray-400'
                        : 'bg-white border-slate-200 text-slate-400'
                    )}
                  />
                  <span className={clsx(
                    'px-3 py-2 rounded-lg text-xs font-bold',
                    darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                  )}>
                    Coming Soon
                  </span>
                </div>
                <p className={clsx('text-xs mt-2', darkMode ? 'text-gray-600' : 'text-slate-500')}>
                  Gmail integration will be available after migration is complete
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Watchlist', value: '25', icon: '⭐' },
                  { label: 'Alerts', value: '12', icon: '🔔' },
                  { label: 'Days Active', value: '47', icon: '📅' },
                ].map(stat => (
                  <div key={stat.label} className={clsx(
                    'p-4 rounded-lg border text-center',
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                  )}>
                    <div className="text-2xl mb-1">{stat.icon}</div>
                    <div className={clsx('text-2xl font-black', darkMode ? 'text-white' : 'text-slate-900')}>
                      {stat.value}
                    </div>
                    <div className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-500')}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Theme Tab */}
          {activeTab === 'theme' && (
            <div className="space-y-4">
              <p className={clsx('text-sm', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                Choose your preferred theme for NexRadar Pro
              </p>

              {/* Theme Options */}
              <div className="space-y-3">
                {[
                  { id: 'light', label: 'Light', icon: '☀️', desc: 'Bright and clean interface' },
                  { id: 'dark', label: 'Dark', icon: '🌙', desc: 'Easy on the eyes, perfect for night trading' },
                  { id: 'auto', label: 'Auto (Day/Night)', icon: '⚡', desc: 'Automatically switch based on system settings' },
                ].map(option => (
                  <button
                    key={option.id}
                    onClick={() => handleThemeChange(option.id)}
                    className={clsx(
                      'w-full p-4 rounded-xl border-2 transition-all text-left',
                      theme === option.id
                        ? darkMode
                          ? 'border-cyan-500 bg-cyan-500/10'
                          : 'border-blue-500 bg-blue-50'
                        : darkMode
                          ? 'border-white/10 bg-white/5 hover:border-white/20'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{option.icon}</span>
                        <div>
                          <div className={clsx('font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                            {option.label}
                          </div>
                          <div className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-500')}>
                            {option.desc}
                          </div>
                        </div>
                      </div>
                      {theme === option.id && (
                        <span className={clsx('text-xl', darkMode ? 'text-cyan-400' : 'text-blue-600')}>
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div className={clsx(
                'p-4 rounded-lg border',
                darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
              )}>
                <div className={clsx('text-xs font-bold uppercase tracking-wider mb-2',
                  darkMode ? 'text-gray-500' : 'text-slate-500')}>
                  Current Theme
                </div>
                <div className={clsx('text-sm font-semibold',
                  darkMode ? 'text-cyan-400' : 'text-blue-600')}>
                  {theme === 'light' ? '☀️ Light Mode' : theme === 'dark' ? '🌙 Dark Mode' : '⚡ Auto Mode'}
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <p className={clsx('text-sm', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                Manage your notification preferences
              </p>

              <div className="space-y-3">
                {[
                  { key: 'volumeSpikes', label: 'Volume Spikes', desc: 'Get notified when stocks show unusual volume', icon: '🔊' },
                  { key: 'gapPlays', label: 'Gap Plays', desc: 'Alerts for significant gap up/down movements', icon: '📊' },
                  { key: 'earnings', label: 'Earnings Reports', desc: 'Upcoming earnings and gap plays', icon: '📰' },
                  { key: 'priceAlerts', label: 'Price Alerts', desc: 'Custom price target notifications', icon: '💰' },
                  { key: 'email', label: 'Email Notifications', desc: 'Receive alerts via email (Coming Soon)', icon: '📧', disabled: true },
                ].map(notif => (
                  <div key={notif.key} className={clsx(
                    'flex items-center justify-between p-4 rounded-lg border',
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200',
                    notif.disabled && 'opacity-50'
                  )}>
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{notif.icon}</span>
                      <div>
                        <div className={clsx('font-semibold text-sm', darkMode ? 'text-white' : 'text-slate-900')}>
                          {notif.label}
                        </div>
                        <div className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-500')}>
                          {notif.desc}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => !notif.disabled && setNotifications(prev => ({
                        ...prev,
                        [notif.key]: !prev[notif.key]
                      }))}
                      disabled={notif.disabled}
                      className={clsx(
                        'relative w-12 h-6 rounded-full transition-all',
                        notifications[notif.key]
                          ? 'bg-cyan-500'
                          : darkMode ? 'bg-gray-700' : 'bg-slate-300',
                        notif.disabled && 'cursor-not-allowed'
                      )}
                    >
                      <span className={clsx(
                        'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all',
                        notifications[notif.key] ? 'left-6' : 'left-0.5'
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <p className={clsx('text-sm', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                Configure your trading preferences
              </p>

              <div className="space-y-4">
                {/* Data Refresh */}
                <div className={clsx(
                  'p-4 rounded-lg border',
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                )}>
                  <label className={clsx('text-sm font-bold mb-2 block',
                    darkMode ? 'text-white' : 'text-slate-900')}>
                    Data Refresh Rate
                  </label>
                  <select className={clsx(
                    'w-full px-3 py-2 rounded-lg text-sm border outline-none',
                    darkMode
                      ? 'bg-white/5 border-white/10 text-white'
                      : 'bg-white border-slate-200 text-slate-900'
                  )}>
                    <option>Real-time (Recommended)</option>
                    <option>Every 5 seconds</option>
                    <option>Every 10 seconds</option>
                    <option>Every 30 seconds</option>
                  </select>
                </div>

                {/* Default View */}
                <div className={clsx(
                  'p-4 rounded-lg border',
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                )}>
                  <label className={clsx('text-sm font-bold mb-2 block',
                    darkMode ? 'text-white' : 'text-slate-900')}>
                    Default View
                  </label>
                  <select className={clsx(
                    'w-full px-3 py-2 rounded-lg text-sm border outline-none',
                    darkMode
                      ? 'bg-white/5 border-white/10 text-white'
                      : 'bg-white border-slate-200 text-slate-900'
                  )}>
                    <option>Dashboard</option>
                    <option>Live Table</option>
                    <option>Chart</option>
                    <option>Signals</option>
                  </select>
                </div>

                {/* Danger Zone */}
                <div className={clsx(
                  'p-4 rounded-lg border-2',
                  darkMode ? 'bg-red-950/20 border-red-500/30' : 'bg-red-50 border-red-200'
                )}>
                  <div className={clsx('text-sm font-bold mb-2',
                    darkMode ? 'text-red-400' : 'text-red-700')}>
                    Danger Zone
                  </div>
                  <button className={clsx(
                    'w-full px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    darkMode
                      ? 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30'
                      : 'bg-red-100 border border-red-300 text-red-700 hover:bg-red-200'
                  )}>
                    Clear All Data & Reset
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={clsx(
          'flex items-center justify-between px-6 py-4 border-t',
          darkMode ? 'border-white/10 bg-[#161b22]' : 'border-slate-200 bg-slate-50'
        )}>
          <div className={clsx('text-xs', darkMode ? 'text-gray-600' : 'text-slate-500')}>
            NexRadar Pro v4.2
          </div>
          <button
            onClick={onClose}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              darkMode
                ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            )}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
