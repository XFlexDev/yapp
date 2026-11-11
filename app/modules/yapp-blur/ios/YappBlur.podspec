Pod::Spec.new do |s|
  s.name           = 'YappBlur'
  s.version        = '1.0.0'
  s.summary        = 'Variable (progressive) backdrop blur for yapp'
  s.description    = 'Variable (progressive) backdrop blur for yapp'
  s.license        = 'MIT'
  s.author         = 'kreatix'
  s.homepage       = 'https://yap.kreatix.dev'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/XFlexDev/yapp.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
