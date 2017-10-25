export default function(params) {
  return `
  #version 100
  precision highp float;
  
  uniform sampler2D u_gbuffers[${params.numGBuffers}];
  
  uniform sampler2D u_colmap;
  uniform sampler2D u_normap;
  uniform sampler2D u_lightbuffer;
  uniform mat4 u_viewMatrix;
  uniform mat4 u_invViewMatrix;
  uniform mat4 u_invProjectionMatrix;
  // TODO: Read this buffer to determine the lights influencing a cluster
  uniform sampler2D u_clusterbuffer;
  uniform float u_farPlane;
  uniform float u_nearPlane;
  varying vec2 v_uv;

  vec3 applyNormalMap(vec3 geomnor, vec3 normap) {
    normap = normap * 2.0 - 1.0;
    vec3 up = normalize(vec3(0.001, 1, 0.001));
    vec3 surftan = normalize(cross(geomnor, up));
    vec3 surfbinor = cross(geomnor, surftan);
    return normap.y * surftan + normap.x * surfbinor + normap.z * geomnor;
  }

  struct Light {
    vec3 position;
    float radius;
    vec3 color;
  };

  float ExtractFloat(sampler2D texture, int textureWidth, int textureHeight, int index, int component) {
    float u = float(index + 1) / float(textureWidth + 1);
    int pixel = component / 4;
    float v = float(pixel + 1) / float(textureHeight + 1);
    vec4 texel = texture2D(texture, vec2(u, v));
    int pixelComponent = component - pixel * 4;
    if (pixelComponent == 0) {
      return texel[0];
    } else if (pixelComponent == 1) {
      return texel[1];
    } else if (pixelComponent == 2) {
      return texel[2];
    } else if (pixelComponent == 3) {
      return texel[3];
    }
  }

  Light UnpackLight(int index) {
    Light light;
    float u = float(index + 1) / float(${params.numLights + 1});
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.3));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.6));
    light.position = v1.xyz;

    // LOOK: This extracts the 4th float (radius) of the (index)th light in the buffer
    // Note that this is just an example implementation to extract one float.
    // There are more efficient ways if you need adjacent values
    light.radius = ExtractFloat(u_lightbuffer, ${params.numLights}, 2, index, 3);

    light.color = v2.rgb;
    return light;
  }

  // Cubic approximation of gaussian curve so we falloff to exactly 0 at the light radius
  float cubicGaussian(float h) {
    if (h < 1.0) {
      return 0.25 * pow(2.0 - h, 3.0) - pow(1.0 - h, 3.0);
    } else if (h < 2.0) {
      return 0.25 * pow(2.0 - h, 3.0);
    } else {
      return 0.0;
    }
  }

  void main() {
//    vec3 albedo = texture2D(u_colmap, v_uv).rgb;
//    vec3 normap = texture2D(u_normap, v_uv).xyz;
//    vec3 normal = applyNormalMap(v_normal, normap);
    vec4 buf0val = texture2D(u_gbuffers[0], v_uv);
    vec4 buf1val = texture2D(u_gbuffers[1], v_uv);
    vec4 buf2val = texture2D(u_gbuffers[2], v_uv);
    vec3 albedo = buf0val.rgb;
    vec3 normal = buf2val.xyz;
    vec3 v_position = buf1val.xyz;
    
    vec3 fragColor = vec3(0.0);
//Determine the cluster for a fragment
//hard code near and far
    const int num_xSlices = ${params.xSliceCount};
    const int num_ySlices = ${params.ySliceCount};
    const int num_zSlices = ${params.zSliceCount};
    vec4 viewCoords = vec4(gl_FragCoord.xyz,1);
    viewCoords = u_invProjectionMatrix * viewCoords;
    const int numClusters = num_xSlices * num_ySlices * num_zSlices;
    float nearPlane = u_farPlane;
    float farPlane  = u_nearPlane;
    float specialNearPlane = 3.0;
    float xSliceWidth = float(${params.screenWidth})   /  float(${params.xSliceCount});
    float ySliceWidth = float(${params.screenHeight})  /  float(${params.ySliceCount});
    vec4 CameraCoordinate = vec4(v_position,1) * u_viewMatrix;
    int xid = int(gl_FragCoord.x / xSliceWidth);
    int yid = int(gl_FragCoord.y / ySliceWidth);
    float viewZ = viewCoords.z;
    int zid = 0;    
    //special near depth slice    
    if(viewZ >= specialNearPlane)
    {
      //0....1
      float normalizedZ = log(viewZ - specialNearPlane + 1.0) / log(farPlane - specialNearPlane + 1.0);
      zid =  int(normalizedZ * float(num_zSlices - 1))  + 1;
    } 
    int clusterIndex = xid + yid * num_xSlices + zid * num_xSlices * num_ySlices;
    float clusterUcoord = float(clusterIndex + 1) / float(numClusters + 1);
    //Read in the lights in that cluster from the populated data
    int lightCount = int(texture2D(u_clusterbuffer, vec2(clusterUcoord, 0.0))[0]);   
    const int maxNumLights = int(min(float(${params.numLights}), float(${params.num_maxLightsPerCluster})));
    //Do shading for just those lights
    for (int i = 1; i <= maxNumLights; i++)
    {
      if (lightCount < i)
      {
        break;
      }
      int clusterTexelIndex = i / 4;          
      float clustersLightVcoord = float(clusterTexelIndex + 1) / ceil(float(${params.num_maxLightsPerCluster} + 1) * 0.25  + 1.0);    
     
      vec4 clusterTexel = texture2D(u_clusterbuffer, vec2(clusterUcoord, clustersLightVcoord));
      int lightIndex;
      int reminder = i - 4 * clusterTexelIndex;
      //fetch
      if (reminder == 0)      
        lightIndex = int(clusterTexel[0]);      
      else if (reminder == 1)     
        lightIndex = int(clusterTexel[1]);      
      else if (reminder == 2)      
        lightIndex = int(clusterTexel[2]);
      else if (reminder == 3)
        lightIndex = int(clusterTexel[3]);
      else     
        continue;     
      
      
      //from forward.frag.glsl.js
      //assume that only point light will be used
    
      Light thisLight = UnpackLight(lightIndex);
      float lightDistance = distance(thisLight.position, v_position);
      vec3 L = (thisLight.position - v_position) / lightDistance;
      
      float lightIntensity = cubicGaussian(2.0 * lightDistance / thisLight.radius);
      float NoL = max(dot(L, normal), 0.0);
      //Blinn-phong
      vec4 cameraWorldPos = u_invViewMatrix*vec4(0.0,0.0,0.0,1.0);
      
      vec3 viewVec = normalize(cameraWorldPos.xyz - v_position);
      vec3 halfVec = normalize(L + viewVec);
      float NoH = max(dot(halfVec, normal), 0.0);
      vec3 diffuseTerm = albedo;
      float speculatTerm = pow(NoH, 100.0);      
      fragColor += (diffuseTerm + vec3(speculatTerm)) * NoL * lightIntensity * thisLight.color;
    }
//Original code for all lights

    const vec3 ambientLight = vec3(0.025);
    fragColor += albedo * ambientLight;

    gl_FragColor = vec4(fragColor, 1.0);
    //gl_FragCoord
    //Test code.
    //gl_FragColor = vec4(gl_FragCoord.x / 640.0, gl_FragCoord.y / 480.0, 0, 1);
  }
  `;
}