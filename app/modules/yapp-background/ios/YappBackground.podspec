Pod::Spec.new do |s|
  s.name           = 'YappBackground'
  s.version        = '1.0.0'
  s.summary        = 'Keeps Yapp running in the background'
  s.description    = 'Keeps Yapp running in the background so friends can be heard with the screen off'
  s.license        = 'UNLICENSED'
  s.author         = 'Kreatix'
  s.homepage       = 'https://yap.kreatix.dev'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/XFlexDev/yapp.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
