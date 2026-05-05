require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PraeventioCapacitorMesh'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/praeventio/praeventio-guard'
  s.author = 'Praeventio'
  s.source = { :git => 'https://github.com/praeventio/praeventio-guard.git', :tag => s.version.to_s }
  s.source_files = 'ios/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.5'
end
